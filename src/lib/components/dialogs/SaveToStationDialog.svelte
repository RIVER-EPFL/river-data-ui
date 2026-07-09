<script lang="ts">
	import {
		api,
		type Site,
		type SiteParameter,
		type Parameter,
		type Sensor,
		type SensorCalibration,
	} from '$api/crud';
	import { saveGrabSample } from '$api/service';
	import { me } from '$auth/me.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { toDatetimeLocal, fromDatetimeLocal } from '$lib/utils';
	import Button from '$components/ui/Button.svelte';
	import Dialog from '$components/ui/Dialog.svelte';

	const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const zoneOptions =
		typeof Intl.supportedValuesOf === 'function'
			? Intl.supportedValuesOf('timeZone')
			: [browserZone, 'UTC'];

	// Persists a tool's computed result back to a station as a single grab-sample
	// reading. The result map from a tool is a flat object of numeric outputs; the
	// caller picks which one is the primary value to save (pre-filled, editable).
	let {
		open = $bindable(false),
		toolTitle = '',
		results = null,
	}: {
		open: boolean;
		toolTitle?: string;
		results?: Record<string, unknown> | null;
	} = $props();

	// Flat list of numeric result fields the user can choose to save.
	const numericFields = $derived(
		Object.entries(results ?? {})
			.filter(([, v]) => typeof v === 'number' && Number.isFinite(v as number))
			.map(([key, v]) => ({ key, value: v as number })),
	);

	// Best-guess primary output: first numeric field that isn't a standard deviation.
	function primaryKey(fields: { key: string; value: number }[]): string {
		const preferred = fields.find((f) => !/_(sd|std|stdev|stddev)$/i.test(f.key));
		return (preferred ?? fields[0])?.key ?? '';
	}

	let sites = $state<Site[]>([]);
	let siteParams = $state<SiteParameter[]>([]);
	let params = $state<Parameter[]>([]);

	let selectedSiteId = $state('');
	let selectedParamId = $state('');
	let selectedFieldKey = $state('');
	let collectedAt = $state(toDatetimeLocal(Date.now(), browserZone));
	let collectedZone = $state(browserZone);
	let value = $state('');
	let label = $state('');

	let loadingSite = $state(false);
	let saving = $state(false);

	// Instrument + standard-curve provenance (all optional). A grab with no instrument/curve is
	// stored raw, preserving the original behavior.
	type InstrumentFilter = 'field' | 'lab' | 'all';
	let instruments = $state<Sensor[]>([]);
	let instrumentFilter = $state<InstrumentFilter>('field');
	let selectedInstrumentId = $state('');

	let curves = $state<SensorCalibration[]>([]);
	let loadingCurves = $state(false);
	let selectedCurveId = $state('');

	let showAddCurve = $state(false);
	let newCurveName = $state('');
	let newCurveSlope = $state('');
	let newCurveIntercept = $state('');
	let newCurveR2 = $state('');
	let creatingCurve = $state(false);

	const filteredInstruments = $derived(
		instruments.filter((i) => {
			if (instrumentFilter === 'lab') return i.is_lab_instrument === true;
			if (instrumentFilter === 'field') return i.is_lab_instrument !== true;
			return true;
		}),
	);

	const selectedCurve = $derived(curves.find((c) => c.id === selectedCurveId) ?? null);

	// Live corrected value: slope * value + intercept, recomputed as either changes.
	const correctedValue = $derived.by(() => {
		if (!selectedCurve) return null;
		const v = Number(value);
		if (value === '' || !Number.isFinite(v)) return null;
		return selectedCurve.slope * v + selectedCurve.intercept;
	});

	function instrumentLabel(i: Sensor): string {
		const name = i.name ?? i.serial_number ?? i.id;
		return `${name} (${i.is_lab_instrument ? 'Lab' : 'Field'})`;
	}

	function curveLabel(c: SensorCalibration): string {
		const name = c.name ?? 'unnamed';
		return `${name} — y = ${c.slope}x + ${c.intercept} (${c.mode})`;
	}

	function fmtCorrected(n: number): string {
		return Number.isInteger(n) ? String(n) : n.toPrecision(6);
	}

	async function loadInstruments() {
		if (instruments.length > 0) return;
		try {
			const res = await api.sensors.list({
				perPage: 1000,
				filter: { is_active: true },
				sort: ['name', 'ASC'],
			});
			instruments = res.data;
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to load instruments');
		}
	}

	async function loadCurves(sensorId: string) {
		selectedCurveId = '';
		showAddCurve = false;
		curves = [];
		if (!sensorId) return;
		loadingCurves = true;
		try {
			const res = await api.sensorCalibrations.list({
				perPage: 200,
				filter: { sensor_id: sensorId },
				sort: ['valid_from', 'DESC'],
			});
			curves = res.data;
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to load curves');
		} finally {
			loadingCurves = false;
		}
	}

	const canCreateCurve = $derived(
		!!selectedInstrumentId &&
			me.can('manageSensors') &&
			Number.isFinite(Number(newCurveSlope)) &&
			newCurveSlope !== '' &&
			Number(newCurveSlope) !== 0 &&
			Number.isFinite(Number(newCurveIntercept)) &&
			newCurveIntercept !== '',
	);

	async function createCurve() {
		if (!canCreateCurve) return;
		creatingCurve = true;
		try {
			const created = await api.sensorCalibrations.create({
				sensor_id: selectedInstrumentId,
				name: newCurveName.trim() || null,
				mode: 'instant',
				slope: Number(newCurveSlope),
				intercept: Number(newCurveIntercept),
				r_squared: newCurveR2 !== '' && Number.isFinite(Number(newCurveR2)) ? Number(newCurveR2) : null,
			});
			curves = [created, ...curves];
			selectedCurveId = created.id;
			showAddCurve = false;
			newCurveName = '';
			newCurveSlope = '';
			newCurveIntercept = '';
			newCurveR2 = '';
			toastStore.success('Curve created');
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to create curve');
		} finally {
			creatingCurve = false;
		}
	}

	// Reset and (re)load sites each time the dialog opens.
	$effect(() => {
		if (!open) return;
		selectedSiteId = '';
		selectedParamId = '';
		siteParams = [];
		collectedAt = toDatetimeLocal(Date.now(), browserZone);
		collectedZone = browserZone;
		label = '';
		instrumentFilter = 'field';
		selectedInstrumentId = '';
		curves = [];
		selectedCurveId = '';
		showAddCurve = false;
		newCurveName = '';
		newCurveSlope = '';
		newCurveIntercept = '';
		newCurveR2 = '';
		selectedFieldKey = primaryKey(numericFields);
		value = selectedFieldKey
			? String(numericFields.find((f) => f.key === selectedFieldKey)?.value ?? '')
			: '';
		void loadSites();
		void loadInstruments();
	});

	async function loadSites() {
		if (sites.length > 0) return;
		try {
			const [s, p] = await Promise.all([
				api.sites.list({ perPage: 200, sort: ['name', 'ASC'] }),
				api.parameters.list({ perPage: 500 }),
			]);
			sites = s.data;
			params = p.data;
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to load sites');
		}
	}

	// Reload the site's parameters whenever the chosen site changes.
	async function loadSiteParameters(siteId: string) {
		selectedParamId = '';
		siteParams = [];
		if (!siteId) return;
		loadingSite = true;
		try {
			const res = await api.siteParameters.list({ perPage: 500, filter: { site_id: siteId } });
			siteParams = res.data;
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to load site parameters');
		} finally {
			loadingSite = false;
		}
	}

	function paramLabel(sp: SiteParameter): string {
		const param = params.find((p) => p.id === sp.parameter_id);
		const name = param?.name ?? sp.name ?? sp.parameter_id;
		const units = sp.display_units ?? param?.default_units ?? '';
		return units ? `${name} (${units})` : name;
	}

	function onPickField() {
		const f = numericFields.find((f) => f.key === selectedFieldKey);
		if (f) value = String(f.value);
	}

	const canSave = $derived(
		!!selectedSiteId && !!selectedParamId && !!collectedAt && Number.isFinite(Number(value)) && value !== '',
	);

	async function handleSave() {
		if (!canSave) {
			toastStore.error('Select a site, a parameter, and enter a numeric value');
			return;
		}
		saving = true;
		try {
			const res = await saveGrabSample({
				site_id: selectedSiteId,
				readings: [
					{
						parameter_id: selectedParamId,
						time: fromDatetimeLocal(collectedAt, collectedZone),
						value: Number(value),
						replicate_index: 0,
						...(selectedInstrumentId ? { sensor_id: selectedInstrumentId } : {}),
						...(selectedCurveId ? { calibration_id: selectedCurveId } : {}),
					},
				],
			});
			const note = label.trim() ? ` (${label.trim()})` : '';
			toastStore.success(`Saved ${res.inserted} reading to station${note}`);
			open = false;
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to save to station');
		} finally {
			saving = false;
		}
	}
</script>

<Dialog bind:open title="Save to Station{toolTitle ? `: ${toolTitle}` : ''}" maxWidth="sm">
	{#snippet children()}
		<div class="space-y-3">
			<div class="flex flex-col gap-1">
				<label for="sts-site" class="text-sm font-medium">Site <span class="text-severity-alarm">*</span></label>
				<select
					id="sts-site"
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
				<label for="sts-param" class="text-sm font-medium">Parameter <span class="text-severity-alarm">*</span></label>
				<select
					id="sts-param"
					bind:value={selectedParamId}
					disabled={!selectedSiteId || loadingSite}
					class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm disabled:opacity-50"
				>
					<option value="">{loadingSite ? 'Loading…' : !selectedSiteId ? 'Select a site first' : siteParams.length ? ' - Select parameter - ' : 'No parameters at this site'}</option>
					{#each siteParams as sp}
						<option value={sp.parameter_id}>{paramLabel(sp)}</option>
					{/each}
				</select>
			</div>

			{#if numericFields.length > 1}
				<div class="flex flex-col gap-1">
					<label for="sts-field" class="text-sm font-medium">Result field</label>
					<select
						id="sts-field"
						bind:value={selectedFieldKey}
						onchange={onPickField}
						class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
					>
						{#each numericFields as f}
							<option value={f.key}>{f.key.replace(/_/g, ' ')} = {f.value.toPrecision(6)}</option>
						{/each}
					</select>
				</div>
			{/if}

			<div class="grid grid-cols-2 gap-3">
				<div class="flex flex-col gap-1">
					<label for="sts-time" class="text-sm font-medium">Timestamp <span class="text-severity-alarm">*</span></label>
					<input id="sts-time" type="datetime-local" bind:value={collectedAt} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
					<select bind:value={collectedZone} aria-label="Time zone" class="px-3 py-1 border border-brand-divider rounded-md bg-brand-surface text-xs">
						{#each zoneOptions as z}<option value={z}>{z}</option>{/each}
					</select>
				</div>
				<div class="flex flex-col gap-1">
					<label for="sts-value" class="text-sm font-medium">Value <span class="text-severity-alarm">*</span></label>
					<input id="sts-value" type="number" step="any" bind:value class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
				</div>
			</div>

			<div class="flex flex-col gap-1 border-t border-brand-divider pt-3">
				<span class="text-sm font-medium">Instrument <span class="text-brand-muted font-normal">(optional)</span></span>
				<div class="flex gap-1">
					{#each ['field', 'lab', 'all'] as f}
						<button
							type="button"
							onclick={() => (instrumentFilter = f as InstrumentFilter)}
							class="px-2 py-0.5 text-xs rounded-md border {instrumentFilter === f
								? 'bg-brand-primary text-white border-brand-primary'
								: 'bg-brand-surface text-brand-muted border-brand-divider'}"
						>{f === 'field' ? 'Field' : f === 'lab' ? 'Lab' : 'All'}</button>
					{/each}
				</div>
				<select
					id="sts-instrument"
					bind:value={selectedInstrumentId}
					onchange={() => loadCurves(selectedInstrumentId)}
					class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
				>
					<option value="">— none —</option>
					{#each filteredInstruments as i}
						<option value={i.id}>{instrumentLabel(i)}</option>
					{/each}
				</select>
			</div>

			{#if selectedInstrumentId}
				<div class="flex flex-col gap-1">
					<label for="sts-curve" class="text-sm font-medium">Standard curve <span class="text-brand-muted font-normal">(optional)</span></label>
					{#if loadingCurves}
						<p class="text-xs text-brand-muted">Loading…</p>
					{:else if curves.length === 0}
						<p class="text-xs text-brand-muted">No curves on this instrument</p>
					{:else}
						<select
							id="sts-curve"
							bind:value={selectedCurveId}
							class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
						>
							<option value="">— none (store raw) —</option>
							{#each curves as c}
								<option value={c.id}>{curveLabel(c)}</option>
							{/each}
						</select>
					{/if}

					{#if correctedValue !== null && selectedCurve}
						<p class="text-xs text-brand-muted">
							Corrected: {selectedCurve.slope} × {value} + {selectedCurve.intercept} =
							<span class="font-medium text-brand-text">{fmtCorrected(correctedValue)}</span>
						</p>
					{:else if !selectedCurveId}
						<p class="text-xs text-brand-muted">Stored raw</p>
					{/if}

					{#if me.can('manageSensors')}
						<button
							type="button"
							onclick={() => (showAddCurve = !showAddCurve)}
							class="self-start text-xs text-brand-primary hover:underline"
						>{showAddCurve ? '− Cancel' : '+ Add curve'}</button>

						{#if showAddCurve}
							<div class="flex flex-col gap-2 border border-brand-divider rounded-md p-2">
								<input
									type="text"
									bind:value={newCurveName}
									placeholder="Curve name (optional)"
									class="px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-sm"
								/>
								<div class="grid grid-cols-3 gap-2">
									<input type="number" step="any" bind:value={newCurveSlope} placeholder="slope *" class="px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-sm" />
									<input type="number" step="any" bind:value={newCurveIntercept} placeholder="intercept *" class="px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-sm" />
									<input type="number" step="any" bind:value={newCurveR2} placeholder="r²" class="px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-sm" />
								</div>
								{#if newCurveSlope !== '' && Number(newCurveSlope) === 0}
									<p class="text-xs text-severity-alarm">Slope cannot be zero.</p>
								{/if}
								<Button size="sm" variant="primary" onclick={createCurve} disabled={!canCreateCurve || creatingCurve}>
									{creatingCurve ? 'Creating…' : 'Create curve'}
								</Button>
							</div>
						{/if}
					{/if}
				</div>
			{/if}

			<div class="flex flex-col gap-1">
				<label for="sts-label" class="text-sm font-medium">Label / note <span class="text-brand-muted font-normal">(optional)</span></label>
				<input id="sts-label" type="text" bind:value={label} placeholder="e.g. field campaign, lab batch…" class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
			</div>

			<p class="text-xs text-brand-muted">
				Saves the value as a single grab-sample reading on the selected site parameter.
			</p>
		</div>
	{/snippet}
	{#snippet actions()}
		<Button onclick={() => (open = false)}>Cancel</Button>
		<Button
			variant="primary"
			onclick={handleSave}
			disabled={saving || !canSave}
		>{saving ? 'Saving…' : 'Save'}</Button>
	{/snippet}
</Dialog>
