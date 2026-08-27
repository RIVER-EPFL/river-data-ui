<script lang="ts" module>
	// A curve consumed by the calculation, recorded into the provenance blob.
	export interface UsedCurve {
		name: string;
		slope: number | null;
		intercept: number | null;
		label: string | null;
		standard_curve_id: string | null;
	}
</script>

<script lang="ts">
	import { base } from '$app/paths';
	import { api, type Site, type SiteParameter, type Parameter, type Sensor, type StandardCurve } from '$api/crud';
	import { listAll } from '$api/paged';
	import {
		saveGrabSample,
		grabConflictGroups,
		type GrabExistingGroup,
		type GrabPreviewRow,
		type GrabSampleReading,
		type ToolCurveSnapshot,
		type ToolOutput,
		type ToolVersionRef,
	} from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { toDatetimeLocal, fromDatetimeLocal, formatDateTime } from '$lib/utils';
	import { curveEquation, curveLabel } from '$lib/standardCurves';
	import Button from '$components/ui/Button.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import ParameterSelect from '$components/ParameterSelect.svelte';

	const BROWSER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const ZONE_OPTIONS =
		typeof Intl.supportedValuesOf === 'function'
			? Intl.supportedValuesOf('timeZone')
			: [BROWSER_ZONE, 'UTC'];

	// Persists a tool's computed outputs to a site as one grab-sample request. The request names
	// the server-stored tool run (`tool_run_id`) and each reading's output key; the server builds
	// the provenance blob from its own run row, so nothing here authors provenance.
	let {
		open = $bindable(false),
		runId = null,
		toolName = '',
		toolTitle = '',
		results = null,
		outputs = [],
		toolVersion = null,
		calcInputs = null,
		curvesUsed = [],
		serverConstants = null,
		serverCurves = [],
		appliedCurveLabel = '',
	}: {
		open: boolean;
		/** The stored tool run these results came from (`run_id` on the calculate response). */
		runId?: string | null;
		toolName?: string;
		toolTitle?: string;
		results?: Record<string, unknown> | null;
		/** The tool's manifest outputs; drives replicate grouping and default parameter mapping. */
		outputs?: ToolOutput[];
		toolVersion?: ToolVersionRef | null;
		/** The exact calculate request body these results came from. */
		calcInputs?: Record<string, unknown> | null;
		/** The browser's curve picker state; a fallback for provenance when `serverCurves` is empty. */
		curvesUsed?: UsedCurve[];
		/** Constant values the server resolved for this run, by name. */
		serverConstants?: Record<string, number> | null;
		/** Curves as the runner received them, the authority on what produced these numbers. */
		serverCurves?: ToolCurveSnapshot[];
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
		label: string | null;
		units: string | null;
		/** `index` is the replicate slot the value is stored at; see `replicateIndex`. */
		values: { key: string; value: number; index: number }[];
		replicateGroup: boolean;
		/** Names no catalog parameter, so there is nowhere to write it: display-only. */
		displayOnly: boolean;
		/** The parameter the server resolved this output to, null when it resolves to nothing. */
		resolvedParameterId: string | null;
		suggestedCode: string | null;
		defaultInclude: boolean;
	}

	const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

	/** The catalog parameter an output declares, by either half of the declaration. */
	const linkedParameter = (o: ToolOutput) =>
		o.parameter?.id ?? o.parameter_id ?? o.suggested_parameter_code ?? null;

	/**
	 * An output is never saved when it names no catalog parameter (nowhere to write it) or when it
	 * summarises another output, per replicate or not: a replicated measurement is stored at the
	 * replicate level and its summaries are derived by the database.
	 */
	const displayOnlyOutput = (o: ToolOutput) => o.aggregate_of !== null || !linkedParameter(o);

	const LETTER_A = 'A'.charCodeAt(0);

	/**
	 * The replicate slot a suffix stands for. Replicate letters are a client-side convention with no
	 * server-side representation, so the mapping is decided here: a single letter is its position in
	 * the alphabet, anything else falls back to its position in the sorted group.
	 */
	function replicateIndices(suffixes: string[]): number[] {
		const letters = suffixes.map((s) => (/^[A-Za-z]$/.test(s) ? s.toUpperCase().charCodeAt(0) - LETTER_A : -1));
		const usable = letters.every((n) => n >= 0) && new Set(letters).size === letters.length;
		return usable ? letters : suffixes.map((_, i) => i);
	}

	// Rows follow the manifest: per_replicate outputs group their suffixed result keys
	// ({base}_{rep}). An output that names no catalog parameter has nowhere to be written and is
	// display-only, whether it summarises another output or nothing at all. Result keys no output
	// covers fall back to plain single-value rows, mapped by hand.
	const rows = $derived.by((): ResultRow[] => {
		const numeric = Object.entries(results ?? {}).filter(
			([, v]) => typeof v === 'number' && Number.isFinite(v as number),
		) as [string, number][];
		const byKey = new Map(numeric);
		const covered = new Set<string>();
		const out: ResultRow[] = [];
		// A replicate suffix pattern also matches the manifest's own avg/sd keys (DIC_{rep} against
		// DIC_avg), so keys another output declares are never swept into the replicate group: they
		// are aggregates, and saving them as replicates would skew the sample statistics.
		const declaredElsewhere = new Set(outputs.filter((o) => !o.per_replicate).map((o) => o.key));

		for (const o of outputs) {
			const cbase = o.key.replace(/_?\{rep\}/, '');
			if (o.per_replicate) {
				const re = new RegExp(`^${esc(cbase)}_([A-Za-z0-9]+)$`);
				const members = numeric
					.filter(([k]) => !covered.has(k) && !declaredElsewhere.has(k) && re.test(k))
					.map(([key, value]) => ({ key, value, suffix: key.match(re)![1] }))
					.sort((a, b) => a.suffix.localeCompare(b.suffix, undefined, { numeric: true }));
				if (members.length === 0) continue;
				for (const m of members) covered.add(m.key);
				// A family can be gapped: a replicate the script could not compute has no key at all.
				// Indices come from the letters so the gap is stored rather than closed up.
				const indices = replicateIndices(members.map((m) => m.suffix));
				out.push({
					id: cbase,
					displayKey: cbase,
					label: o.label,
					units: o.units,
					values: members.map(({ key, value }, i) => ({ key, value, index: indices[i] })),
					replicateGroup: members.length > 1,
					displayOnly: displayOnlyOutput(o),
					resolvedParameterId: o.parameter?.id ?? null,
					suggestedCode: o.parameter?.code ?? o.suggested_parameter_code,
					defaultInclude: !displayOnlyOutput(o),
				});
			} else {
				const value = byKey.get(o.key);
				if (value === undefined || covered.has(o.key)) continue;
				covered.add(o.key);
				const displayOnly = displayOnlyOutput(o);
				out.push({
					id: o.key,
					displayKey: o.key,
					label: o.label,
					units: o.units,
					values: [{ key: o.key, value, index: 0 }],
					replicateGroup: false,
					displayOnly,
					resolvedParameterId: o.parameter?.id ?? null,
					suggestedCode: o.parameter?.code ?? o.suggested_parameter_code,
					defaultInclude: !displayOnly,
				});
			}
		}
		for (const [key, value] of numeric) {
			if (covered.has(key)) continue;
			out.push({
				id: key,
				displayKey: key,
				label: null,
				units: null,
				values: [{ key, value, index: 0 }],
				replicateGroup: false,
				displayOnly: false,
				resolvedParameterId: null,
				suggestedCode: null,
				defaultInclude: true,
			});
		}
		return out;
	});

	const saveableRows = $derived(rows.filter((r) => !r.displayOnly));

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

	// Server-computed correction chain for the current inputs, refreshed via dry_run.
	let preview = $state<GrabPreviewRow[]>([]);
	let previewGroups = $state<GrabExistingGroup[]>([]);
	let previewBusy = $state(false);
	// Existing replicate groups from a refused save; confirming re-sends with mode: 'replace'.
	let conflictGroups = $state<GrabExistingGroup[] | null>(null);
	let previewTimer: ReturnType<typeof setTimeout> | null = null;
	let previewGeneration = 0;

	// What the runner actually received wins over the browser's picker state: the server resolves a
	// slot to a curve, and only its answer can say which coefficients produced a number. The picker
	// state stands in when a run predates the server snapshot.
	const resolvedCurves = $derived.by((): UsedCurve[] =>
		serverCurves.length > 0
			? serverCurves.map((c) => ({
					name: c.name,
					slope: c.curve.slope,
					intercept: c.curve.intercept,
					label: c.curve.label,
					standard_curve_id: c.curve.standard_curve_id,
				}))
			: curvesUsed,
	);

	// Stored curves consumed by the calculation, noted into the sample notes by default.
	const curveNote = $derived(
		resolvedCurves
			.filter((c) => c.standard_curve_id)
			.map((c) => `${c.name}: ${c.label ?? c.standard_curve_id} [${c.standard_curve_id}]`)
			.join('; '),
	);

	// One calculation's identity. Reopening the dialog on the same results keeps the site, mapping
	// and notes the operator already set; a new calculation starts clean.
	const resultSignature = $derived(`${toolName}|${JSON.stringify(results ?? {})}`);
	// Plain, not reactive: the effect below writes it, and a reactive read would re-arm the effect.
	let appliedSignature = '';

	$effect(() => {
		if (!open) return;
		if (resultSignature === appliedSignature) {
			void loadSites();
			return;
		}
		appliedSignature = resultSignature;
		selectedSiteId = '';
		siteParams = [];
		selectedSensorId = '';
		selectedCurveId = '';
		curves = [];
		collectedAt = toDatetimeLocal(Date.now(), BROWSER_ZONE);
		collectedZone = BROWSER_ZONE;
		label = '';
		notes = curveNote;
		preview = [];
		previewGroups = [];
		conflictGroups = null;
		const inc: Record<string, boolean> = {};
		const pc: Record<string, string> = {};
		for (const r of saveableRows) {
			inc[r.id] = r.defaultInclude;
			pc[r.id] = '';
		}
		included = inc;
		paramChoices = pc;
		void loadSites();
	});

	// Every list is paged to completion: mapping an output to a parameter is a lookup by name over
	// the whole catalog, and a single page silently stops matching once the table outgrows it.
	async function loadSites() {
		if (sites.length > 0) return;
		try {
			const [s, p, i] = await Promise.all([
				listAll(api.sites, { perPage: 200, sort: ['name', 'ASC'] }),
				listAll(api.parameters, { perPage: 500, sort: ['name', 'ASC'] }),
				listAll(api.sensors, {
					perPage: 500,
					filter: { is_active: true },
					sort: ['name', 'ASC'],
				}),
			]);
			sites = s;
			params = p;
			instruments = i;
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

	/** `applyDefaults` is false when refreshing after an inline add, which must not clobber choices. */
	async function loadSiteParameters(siteId: string, applyDefaults = true) {
		if (applyDefaults) siteParams = [];
		if (!siteId) return;
		loadingSite = true;
		try {
			siteParams = await listAll(api.siteParameters, {
				perPage: 500,
				filter: { site_id: siteId },
			});
			if (applyDefaults) applyDefaultMappings();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to load site parameters');
		} finally {
			loadingSite = false;
		}
	}

	// Matching ignores case, spaces, underscores and hyphens so a result key still finds the catalog
	// entry an operator would call the same analyte.
	const norm = (s: string | null | undefined) =>
		(s ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');

	// Each row maps to the parameter the server resolved for that output, matched against the
	// parameters configured at the site. String matching is the fallback only: the seeded manifests
	// declare a code rather than an id, and some of those codes still have no catalog row.
	function applyDefaultMappings() {
		const next = { ...paramChoices };
		for (const r of saveableRows) {
			const byId = r.resolvedParameterId
				? siteParams.find((sp) => sp.parameter_id === r.resolvedParameterId)
				: undefined;
			const bySuggestion =
				byId ??
				(r.suggestedCode
					? siteParams.find((sp) => {
							const p = params.find((pp) => pp.id === sp.parameter_id);
							return norm(p?.code) === norm(r.suggestedCode);
						})
					: undefined);
			const wanted = norm(r.displayKey);
			const byKey =
				bySuggestion ??
				siteParams.find((sp) => {
					const p = params.find((pp) => pp.id === sp.parameter_id);
					return (
						norm(p?.code) === wanted ||
						norm(p?.name) === wanted ||
						norm(sp.name) === wanted ||
						(p?.aliases ?? []).some((a) => norm(a) === wanted)
					);
				});
			next[r.id] = byKey?.parameter_id ?? '';
		}
		paramChoices = next;
	}

	// A row's parameter arrived at the site while the dialog was open, so map it and keep going. The
	// catalog is re-read too: a brand new entry is not in the list this panel loaded on open, and
	// every label and preview name resolves through it.
	async function handleParameterCreated(rowId: string, parameterId: string) {
		const [catalog] = await Promise.all([
			listAll(api.parameters, { perPage: 500, sort: ['name', 'ASC'] }),
			loadSiteParameters(selectedSiteId, false),
		]);
		params = catalog;
		paramChoices = { ...paramChoices, [rowId]: parameterId };
	}

	const selectedSiteName = $derived(sites.find((s) => s.id === selectedSiteId)?.name ?? null);

	function paramLabel(sp: SiteParameter): string {
		const param = params.find((p) => p.id === sp.parameter_id);
		const name = param?.name ?? sp.name ?? sp.parameter_id;
		const units = sp.display_units ?? param?.default_units ?? '';
		return units ? `${name} (${units})` : name;
	}

	const includedRows = $derived(saveableRows.filter((r) => included[r.id]));

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

	// Every reading carries its index: the endpoint preserves a set of indices only when all of them
	// are explicit, and numbers the group contiguously from 0 otherwise, which would close a gap in a
	// replicate family and record the wrong replicate for every value after it.
	function buildReadings(): GrabSampleReading[] {
		const time = fromDatetimeLocal(collectedAt, collectedZone);
		return includedRows.flatMap((r) =>
			r.values.map((v) => ({
				parameter_id: paramChoices[r.id],
				time,
				value: v.value,
				replicate_index: v.index,
				output: v.key,
				...(selectedSensorId ? { sensor_id: selectedSensorId } : {}),
				...(sentCurveId ? { standard_curve_id: sentCurveId } : {}),
			})),
		);
	}

	async function refreshPreview() {
		if (!open) return;
		const gen = ++previewGeneration;
		previewBusy = true;
		try {
			const res = await saveGrabSample({
				site_id: selectedSiteId,
				dry_run: true,
				...(runId ? { tool_run_id: runId } : {}),
				readings: buildReadings(),
			});
			if (gen !== previewGeneration) return;
			preview = res.preview ?? [];
			previewGroups = res.existing_groups ?? [];
		} catch {
			if (gen !== previewGeneration) return;
			preview = [];
			previewGroups = [];
		} finally {
			if (gen === previewGeneration) previewBusy = false;
		}
	}

	$effect(() => {
		if (!open || !canSave) {
			preview = [];
			previewGroups = [];
			return;
		}
		// Read every input the request depends on so a change re-arms the debounce.
		void buildReadings();
		// Changed inputs invalidate a shown conflict; the next save asks again.
		conflictGroups = null;
		if (previewTimer) clearTimeout(previewTimer);
		previewTimer = setTimeout(() => {
			previewTimer = null;
			void refreshPreview();
		}, 400);
	});

	function paramNameById(parameterId: string): string {
		const sp = siteParams.find((p) => p.parameter_id === parameterId);
		if (sp) return paramLabel(sp);
		return params.find((p) => p.id === parameterId)?.name ?? parameterId.slice(0, 8);
	}

	async function handleSave(replace = false) {
		if (!canSave) return;
		saving = true;
		try {
			const res = await saveGrabSample({
				site_id: selectedSiteId,
				...(label.trim() ? { label: label.trim() } : {}),
				...(notes.trim() ? { notes: notes.trim() } : {}),
				...(replace ? { mode: 'replace' as const } : {}),
				...(runId ? { tool_run_id: runId } : {}),
				readings: buildReadings(),
			});
			toastStore.success(
				`Saved ${res.inserted} reading${res.inserted === 1 ? '' : 's'}` +
					(res.samples_created ? ` (${res.samples_created} sample${res.samples_created === 1 ? '' : 's'})` : '') +
					(res.replaced ? `, replaced ${res.replaced}` : ''),
			);
			conflictGroups = null;
			open = false;
		} catch (e) {
			const groups = grabConflictGroups(e);
			if (groups) {
				conflictGroups = groups;
			} else {
				toastStore.error(e instanceof Error ? e.message : 'Failed to save to site');
			}
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
							<tr class="border-t border-brand-divider {row.displayOnly ? 'text-brand-muted' : ''}">
								<td class="px-1 py-1.5 align-top">
									{#if !row.displayOnly}
										<input
											type="checkbox"
											bind:checked={included[row.id]}
											aria-label="Include {row.displayKey}"
										/>
									{/if}
								</td>
								<td class="px-1 py-1.5 align-top">
									{row.label ?? row.displayKey.replace(/_/g, ' ')}
									{#if row.units}<span class="text-xs text-brand-muted">({row.units})</span>{/if}
									{#if row.replicateGroup}
										<span class="text-xs text-brand-muted">({row.values.length} replicates)</span>
									{/if}
								</td>
								<td class="px-1 py-1.5 align-top font-mono text-xs">
									{row.values.map((v) => v.value.toPrecision(6)).join(', ')}
								</td>
								<td class="px-1 py-1.5 align-top">
									{#if row.displayOnly}
										<span class="text-xs text-brand-muted">Not saved</span>
									{:else}
										<!-- Function binding: the choices map is filled by the reset effect, which runs
										     after the dialog body first renders, so a plain binding would hand the
										     child `undefined`. -->
										<ParameterSelect
											bind:value={
												() => paramChoices[row.id] ?? '',
												(v) => (paramChoices = { ...paramChoices, [row.id]: v })
											}
											siteId={selectedSiteId || null}
											{siteParams}
											parameters={params}
											disabled={!selectedSiteId || loadingSite || !included[row.id]}
											placeholder={loadingSite ? 'Loading…' : !selectedSiteId ? 'Select a site first' : ' - Select a parameter at this site - '}
											ariaLabel="Parameter for {row.displayKey}"
											allowAdd
											siteName={selectedSiteName}
											wantedCode={row.suggestedCode ?? row.displayKey}
											wantedLabel={row.label}
											wantedUnits={row.units}
											onCreated={(parameterId) => handleParameterCreated(row.id, parameterId)}
										/>
									{/if}
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

			{#if canSave && (preview.length > 0 || previewBusy)}
				<div class="rounded-md border border-brand-divider bg-brand-bg p-2.5">
					<div class="flex items-center justify-between mb-1.5">
						<span class="text-xs font-semibold">Correction preview</span>
						{#if previewBusy}<span class="text-xs text-brand-muted">Updating…</span>{/if}
					</div>
					{#if preview.length > 0}
						<div class="overflow-x-auto">
							<table class="w-full text-xs">
								<thead>
									<tr class="text-left text-brand-muted">
										<th class="px-1 py-0.5">Parameter</th>
										<th class="px-1 py-0.5 text-right">Raw</th>
										<th class="px-1 py-0.5">Calibration</th>
										<th class="px-1 py-0.5">Standard curve</th>
										<th class="px-1 py-0.5">Applied</th>
										<th class="px-1 py-0.5 text-right">Calibrated</th>
									</tr>
								</thead>
								<tbody>
									{#each preview as row}
										<tr class="border-t border-brand-divider">
											<td class="px-1 py-0.5">
												{paramNameById(row.parameter_id)}
												{#if preview.filter((p) => p.parameter_id === row.parameter_id).length > 1}
													<span class="text-brand-muted">#{row.replicate_index}</span>
												{/if}
											</td>
											<td class="px-1 py-0.5 text-right font-mono">{row.raw_value}</td>
											<td class="px-1 py-0.5 font-mono {row.base_calibration ? '' : 'text-brand-muted'}">
												{row.base_calibration?.equation ?? 'None'}
											</td>
											<td class="px-1 py-0.5 {row.standard_curve ? '' : 'text-brand-muted'}">
												{#if row.standard_curve}
													{#if row.standard_curve.name}{row.standard_curve.name} {/if}<span class="font-mono">{row.standard_curve.equation}</span>
												{:else}
													None
												{/if}
											</td>
											<td class="px-1 py-0.5 font-mono {row.composed_equation ? '' : 'text-brand-muted'}">
												{row.composed_equation ?? 'None'}
											</td>
											<td class="px-1 py-0.5 text-right font-mono">
												{row.calibrated_value ?? row.raw_value}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
					{#if previewGroups.length > 0}
						<p class="text-xs text-severity-warning-text mt-1.5">
							{previewGroups.length} replicate group{previewGroups.length === 1 ? '' : 's'} already exist
							at this timestamp; saving will ask before replacing them.
						</p>
					{/if}
				</div>
			{/if}

			{#if conflictGroups}
				<div class="rounded-md border border-severity-warning-border bg-severity-warning-soft p-2.5 space-y-1.5">
					<p class="text-sm font-medium text-severity-warning-text">
						Readings already exist for {conflictGroups.length === 1 ? 'this parameter and timestamp' : 'these parameters and timestamps'}.
					</p>
					{#each conflictGroups as g}
						<div class="text-xs">
							<span class="font-medium">{paramNameById(g.parameter_id)}</span>
							<span class="text-brand-muted">at {formatDateTime(g.time)}:</span>
							<span class="font-mono">
								{g.replicates.map((r) => r.calibrated_value ?? r.raw_value).join(', ')}
							</span>
						</div>
					{/each}
					<p class="text-xs">Replace overwrites the stored replicates with the values above.</p>
				</div>
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
				share a timestamp with replicate indices so a sample (mean, sd, n) forms; the label,
				notes and the run's provenance (tool version and runner, inputs, constants, curves,
				outputs) are stored on
				those samples. With an instrument set, its calibration for that timestamp is applied,
				then the standard curve if one is chosen; with neither, the reading keeps its raw value
				and no corrected value.
			</p>
		</div>
	{/snippet}
	{#snippet actions()}
		<Button onclick={() => (open = false)}>Cancel</Button>
		{#if conflictGroups}
			<Button variant="danger" onclick={() => handleSave(true)} disabled={saving || !canSave}>
				{saving ? 'Saving…' : 'Replace existing'}
			</Button>
		{:else}
			<Button variant="primary" onclick={() => handleSave()} disabled={saving || !canSave}>
				{saving ? 'Saving…' : 'Save'}
			</Button>
		{/if}
	{/snippet}
</Dialog>
