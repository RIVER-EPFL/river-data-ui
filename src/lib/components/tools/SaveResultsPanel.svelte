<script lang="ts">
	import { base } from '$app/paths';
	import { api, type Site, type SiteParameter, type Parameter, type Sensor, type StandardCurve } from '$api/crud';
	import { saveGrabSample } from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { toDatetimeLocal, fromDatetimeLocal } from '$lib/utils';
	import { curveEquation, curveLabel } from '$lib/standardCurves';
	import Button from '$components/ui/Button.svelte';
	import Dialog from '$components/ui/Dialog.svelte';

	const BROWSER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const ZONE_OPTIONS =
		typeof Intl.supportedValuesOf === 'function'
			? Intl.supportedValuesOf('timeZone')
			: [BROWSER_ZONE, 'UTC'];

	// Persists a tool's computed outputs to a site as one grab-sample request.
	let {
		open = $bindable(false),
		toolTitle = '',
		results = null,
		curveNote = '',
		appliedCurveLabel = '',
	}: {
		open: boolean;
		toolTitle?: string;
		results?: Record<string, unknown> | null;
		curveNote?: string;
		/**
		 * Set when the tool consumed a standard curve during the calculation, so these values are
		 * already corrected. The curve is then shown read-only and no `standard_curve_id` is sent:
		 * the API would otherwise apply the same correction a second time.
		 */
		appliedCurveLabel?: string;
	} = $props();

	interface ResultRow {
		id: string;
		displayKey: string;
		values: { key: string; value: number }[];
		replicateGroup: boolean;
		defaultInclude: boolean;
	}

	const rows = $derived.by((): ResultRow[] => {
		const numeric = Object.entries(results ?? {}).filter(
			([, v]) => typeof v === 'number' && Number.isFinite(v as number),
		) as [string, number][];

		const repRe = /^(.+)_([A-E])$/;
		const groups = new Map<string, { key: string; value: number; letter: string }[]>();
		for (const [key, value] of numeric) {
			const m = key.match(repRe);
			if (m) {
				const list = groups.get(m[1]) ?? [];
				list.push({ key, value, letter: m[2] });
				groups.set(m[1], list);
			}
		}
		const groupedBases = new Set([...groups.keys()].filter((b) => (groups.get(b)?.length ?? 0) >= 2));

		const out: ResultRow[] = [];
		const emittedBases = new Set<string>();
		for (const [key, value] of numeric) {
			const m = key.match(repRe);
			if (m && groupedBases.has(m[1])) {
				if (emittedBases.has(m[1])) continue;
				emittedBases.add(m[1]);
				const members = [...groups.get(m[1])!].sort((a, b) => a.letter.localeCompare(b.letter));
				out.push({
					id: m[1],
					displayKey: m[1],
					values: members.map(({ key: k, value: v }) => ({ key: k, value: v })),
					replicateGroup: true,
					defaultInclude: true,
				});
				continue;
			}
			// An avg/sd alongside its replicate group would land as an extra replicate
			// and skew the sample mean, so those default to excluded.
			const statBase = key.replace(/_(avg|sd|std)$/i, '');
			const shadowedByGroup = statBase !== key && groupedBases.has(statBase);
			out.push({
				id: key,
				displayKey: key,
				values: [{ key, value }],
				replicateGroup: false,
				defaultInclude: !shadowedByGroup,
			});
		}
		return out;
	});

	let sites = $state<Site[]>([]);
	let params = $state<Parameter[]>([]);
	let siteParams = $state<SiteParameter[]>([]);
	let loadingSite = $state(false);

	// Instrument and standard curve are recorded on every emitted reading. Both are optional: a grab
	// with no curve is the normal case, and the API then leaves calibrated_value null rather than
	// pretending an identity curve was applied.
	let instruments = $state<Sensor[]>([]);
	let selectedSensorId = $state('');
	let curves = $state<StandardCurve[]>([]);
	let loadingCurves = $state(false);
	let selectedCurveId = $state('');

	let selectedSiteId = $state('');
	let collectedAt = $state(toDatetimeLocal(Date.now(), BROWSER_ZONE));
	let collectedZone = $state(BROWSER_ZONE);
	let label = $state('');
	let notes = $state('');
	let saving = $state(false);

	let included = $state<Record<string, boolean>>({});
	let paramChoices = $state<Record<string, string>>({});

	$effect(() => {
		if (!open) return;
		selectedSiteId = '';
		siteParams = [];
		selectedSensorId = '';
		selectedCurveId = '';
		curves = [];
		collectedAt = toDatetimeLocal(Date.now(), BROWSER_ZONE);
		collectedZone = BROWSER_ZONE;
		label = '';
		notes = curveNote;
		const inc: Record<string, boolean> = {};
		const pc: Record<string, string> = {};
		for (const r of rows) {
			inc[r.id] = r.defaultInclude;
			pc[r.id] = '';
		}
		included = inc;
		paramChoices = pc;
		void loadSites();
	});

	async function loadSites() {
		if (sites.length > 0) return;
		try {
			const [s, p, i] = await Promise.all([
				api.sites.list({ perPage: 200, sort: ['name', 'ASC'] }),
				api.parameters.list({ perPage: 500 }),
				api.sensors.list({ perPage: 1000, filter: { is_active: true }, sort: ['name', 'ASC'] }),
			]);
			sites = s.data;
			params = p.data;
			instruments = i.data;
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to load sites');
		}
	}

	function instrumentLabel(instrument: Sensor): string {
		const name = instrument.name ?? instrument.serial_number ?? instrument.id;
		return `${name} (${instrument.is_lab_instrument ? 'Lab' : 'Field'})`;
	}

	function curveOptionLabel(curve: StandardCurve): string {
		const r2 = curve.r_squared != null ? `, R² ${curve.r_squared}` : '';
		return `${curveLabel(curve)} · ${curveEquation(curve)}${r2}`;
	}

	// Curves belong to one instrument, so the list is always scoped to the chosen one; that also
	// puts the API's wrong-instrument and no-instrument refusals out of reach from here.
	async function loadCurves(sensorId: string) {
		selectedCurveId = '';
		curves = [];
		if (!sensorId) return;
		loadingCurves = true;
		try {
			const res = await api.standardCurves.list({
				perPage: 200,
				filter: { sensor_id: sensorId },
				sort: ['created_at', 'DESC'],
			});
			curves = res.data;
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to load standard curves');
		} finally {
			loadingCurves = false;
		}
	}

	async function loadSiteParameters(siteId: string) {
		siteParams = [];
		if (!siteId) return;
		loadingSite = true;
		try {
			const res = await api.siteParameters.list({ perPage: 500, filter: { site_id: siteId } });
			siteParams = res.data;
			applyDefaultMappings();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to load site parameters');
		} finally {
			loadingSite = false;
		}
	}

	// Default each row's parameter by case-insensitive match of the result key
	// against the catalog code/name of parameters configured at the site.
	function applyDefaultMappings() {
		const next = { ...paramChoices };
		for (const r of rows) {
			const wanted = r.displayKey.toLowerCase();
			const match = siteParams.find((sp) => {
				const p = params.find((pp) => pp.id === sp.parameter_id);
				return (
					p?.code.toLowerCase() === wanted ||
					p?.name.toLowerCase() === wanted ||
					sp.name?.toLowerCase() === wanted
				);
			});
			next[r.id] = match?.parameter_id ?? '';
		}
		paramChoices = next;
	}

	function paramLabel(sp: SiteParameter): string {
		const param = params.find((p) => p.id === sp.parameter_id);
		const name = param?.name ?? sp.name ?? sp.parameter_id;
		const units = sp.display_units ?? param?.default_units ?? '';
		return units ? `${name} (${units})` : name;
	}

	const includedRows = $derived(rows.filter((r) => included[r.id]));

	const duplicateParam = $derived.by(() => {
		const seen = new Set<string>();
		for (const r of includedRows) {
			const pid = paramChoices[r.id];
			if (!pid) continue;
			if (seen.has(pid)) return true;
			seen.add(pid);
		}
		return false;
	});

	const unmappedIncluded = $derived(includedRows.some((r) => !paramChoices[r.id]));

	const sentCurveId = $derived(appliedCurveLabel ? '' : selectedCurveId);

	const canSave = $derived(
		!!selectedSiteId &&
			!!collectedAt &&
			includedRows.length > 0 &&
			!unmappedIncluded &&
			!duplicateParam,
	);

	async function handleSave() {
		if (!canSave) return;
		saving = true;
		try {
			const time = fromDatetimeLocal(collectedAt, collectedZone);
			const readings = includedRows.flatMap((r) =>
				r.values.map((v, idx) => ({
					parameter_id: paramChoices[r.id],
					time,
					value: v.value,
					replicate_index: idx,
					...(selectedSensorId ? { sensor_id: selectedSensorId } : {}),
					...(sentCurveId ? { standard_curve_id: sentCurveId } : {}),
				})),
			);
			const res = await saveGrabSample({
				site_id: selectedSiteId,
				...(label.trim() ? { label: label.trim() } : {}),
				...(notes.trim() ? { notes: notes.trim() } : {}),
				readings,
			});
			toastStore.success(
				`Saved ${res.inserted} reading${res.inserted === 1 ? '' : 's'}` +
					(res.samples_created ? ` (${res.samples_created} sample${res.samples_created === 1 ? '' : 's'})` : ''),
			);
			open = false;
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to save to site');
		} finally {
			saving = false;
		}
	}
</script>

<Dialog bind:open title="Save to Site{toolTitle ? `: ${toolTitle}` : ''}" maxWidth="lg">
	{#snippet children()}
		<div class="space-y-3">
			<div class="grid grid-cols-2 gap-3">
				<div class="flex flex-col gap-1">
					<label for="srp-site" class="text-sm font-medium">Site <span class="text-severity-alarm">*</span></label>
					<select
						id="srp-site"
						bind:value={selectedSiteId}
						onchange={() => loadSiteParameters(selectedSiteId)}
						class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
					>
						<option value=""> - Select site - </option>
						{#each sites as s}
							<option value={s.id}>{s.name}</option>
						{/each}
					</select>
				</div>
				<div class="flex flex-col gap-1">
					<label for="srp-time" class="text-sm font-medium">Timestamp <span class="text-severity-alarm">*</span></label>
					<input id="srp-time" type="datetime-local" bind:value={collectedAt} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
					<select bind:value={collectedZone} aria-label="Time zone" class="px-3 py-1 border border-brand-divider rounded-md bg-brand-surface text-xs">
						{#each ZONE_OPTIONS as z}<option value={z}>{z}</option>{/each}
					</select>
				</div>
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div class="flex flex-col gap-1">
					<label for="srp-instrument" class="text-sm font-medium">
						Measured on instrument <span class="text-brand-muted font-normal">(optional)</span>
					</label>
					<select
						id="srp-instrument"
						bind:value={selectedSensorId}
						onchange={() => loadCurves(selectedSensorId)}
						class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
					>
						<option value=""> - No instrument recorded - </option>
						{#each instruments as i}
							<option value={i.id}>{instrumentLabel(i)}</option>
						{/each}
					</select>
				</div>
				<div class="flex flex-col gap-1">
					<span class="text-sm font-medium">
						Standard curve <span class="text-brand-muted font-normal">(optional)</span>
					</span>
					{#if appliedCurveLabel}
						<p class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-bg text-sm text-brand-muted">
							{appliedCurveLabel}
						</p>
						<p class="text-xs text-brand-muted">
							Applied during calculation, so these values are already corrected and no curve is
							recorded on the readings.
						</p>
					{:else if !selectedSensorId}
						<p class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-bg text-sm text-brand-muted">
							Select an instrument first
						</p>
					{:else if loadingCurves}
						<p class="text-sm text-brand-muted">Loading…</p>
					{:else if curves.length === 0}
						<p class="text-sm text-brand-muted">
							No standard curves on this instrument.
							<a href="{base}/sensors/{selectedSensorId}?tab=curves" class="text-brand-primary hover:underline">Add one</a>
						</p>
					{:else}
						<select
							bind:value={selectedCurveId}
							aria-label="Standard curve"
							class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
						>
							<option value=""> - No curve - </option>
							{#each curves as c}
								<option value={c.id}>{curveOptionLabel(c)}</option>
							{/each}
						</select>
					{/if}
				</div>
			</div>

			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="text-left text-xs text-brand-muted">
							<th class="px-1 py-1"></th>
							<th class="px-1 py-1">Output</th>
							<th class="px-1 py-1">Value</th>
							<th class="px-1 py-1">Save as parameter</th>
						</tr>
					</thead>
					<tbody>
						{#each rows as row (row.id)}
							<tr class="border-t border-brand-divider">
								<td class="px-1 py-1.5 align-top">
									<input
										type="checkbox"
										bind:checked={included[row.id]}
										aria-label="Include {row.displayKey}"
									/>
								</td>
								<td class="px-1 py-1.5 align-top">
									{row.displayKey.replace(/_/g, ' ')}
									{#if row.replicateGroup}
										<span class="text-xs text-brand-muted">({row.values.length} replicates)</span>
									{/if}
								</td>
								<td class="px-1 py-1.5 align-top font-mono text-xs">
									{row.values.map((v) => v.value.toPrecision(6)).join(', ')}
								</td>
								<td class="px-1 py-1.5 align-top">
									<select
										bind:value={paramChoices[row.id]}
										disabled={!selectedSiteId || loadingSite || !included[row.id]}
										aria-label="Parameter for {row.displayKey}"
										class="w-full px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-sm disabled:opacity-50"
									>
										<option value="">{loadingSite ? 'Loading…' : !selectedSiteId ? 'Select a site first' : ' - Select a parameter at this site - '}</option>
										{#each siteParams as sp}
											<option value={sp.parameter_id}>{paramLabel(sp)}</option>
										{/each}
									</select>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			{#if duplicateParam}
				<p class="text-xs text-severity-alarm">Two included outputs map to the same parameter; each parameter can only be saved once per timestamp.</p>
			{:else if selectedSiteId && unmappedIncluded}
				<p class="text-xs text-brand-muted">Every included output needs a parameter (or untick it).</p>
			{/if}

			<div class="grid grid-cols-2 gap-3">
				<div class="flex flex-col gap-1">
					<label for="srp-label" class="text-sm font-medium">Label <span class="text-brand-muted font-normal">(optional)</span></label>
					<input id="srp-label" type="text" bind:value={label} placeholder="e.g. field campaign, lab batch…" class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
				</div>
				<div class="flex flex-col gap-1">
					<label for="srp-notes" class="text-sm font-medium">Notes <span class="text-brand-muted font-normal">(optional)</span></label>
					<textarea id="srp-notes" rows="2" bind:value={notes} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"></textarea>
				</div>
			</div>

			<p class="text-xs text-brand-muted">
				Saves the ticked outputs as grab-sample readings at the selected site. Replicate outputs
				share a timestamp with replicate indices so a sample (mean, sd, n) forms; the label and
				notes are stored on those samples. With an instrument set, its calibration for that
				timestamp is applied, then the standard curve if one is chosen; with neither, the reading
				keeps its raw value and no corrected value.
			</p>
		</div>
	{/snippet}
	{#snippet actions()}
		<Button onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" onclick={handleSave} disabled={saving || !canSave}>
			{saving ? 'Saving…' : 'Save'}
		</Button>
	{/snippet}
</Dialog>
