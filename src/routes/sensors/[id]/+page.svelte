<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { api, type Sensor, type SensorCalibration, type SensorDeployment, type Site, type Parameter } from '$api/crud';
	import { recalibrateCalibration, rollbackDeployment, reprocessSensor } from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatDateTime } from '$lib/utils';
	import Tabs from '$components/ui/Tabs.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import DeployMoveSensorDialog from '$components/dialogs/DeployMoveSensorDialog.svelte';
	import SensorSeriesChart from '$components/charts/SensorSeriesChart.svelte';
	import CalibrationWindowEditor from '$components/charts/CalibrationWindowEditor.svelte';
	import TimeRangeSlider from '$components/charts/TimeRangeSlider.svelte';
	import AdoptSensorDialog from '$components/dialogs/AdoptSensorDialog.svelte';
	import { getSensorReadings, getSensorDeploymentBands, type SensorReadingsResponse, type SensorDeploymentBand } from '$api/sensors';
	import type { SensorIdentityBand, CalibrationMarker } from '$api/sensors';
	import { GAP_THRESHOLDS } from '$lib/charts/uPlotTheme';

	let sensor = $state<Sensor | null>(null);
	let calibrations = $state<SensorCalibration[]>([]);
	let deployments = $state<SensorDeployment[]>([]);
	let sites = $state<Site[]>([]);
	let loading = $state(true);
	let activeTab = $state(0);

	let parameters = $state<Parameter[]>([]);
	let series = $state<SensorReadingsResponse | null>(null);
	let depBands = $state<SensorDeploymentBand[]>([]);
	let seriesLoading = $state(true);
	let adoptOpen = $state(false);
	let editingCalId = $state<string | null>(null);

	const sensorId = page.params.id!;

	const sensorUnits = $derived(parameters.find((p) => p.id === sensor?.parameter_id)?.default_units ?? '');

	// Adapt deployment bands → the SensorIdentityBand shape the chart plugin expects.
	const identityBands = $derived<SensorIdentityBand[]>(
		depBands.map((d) => ({
			deployment_id: d.deployment_id, sensor_id: sensorId,
			sensor_serial: sensor?.serial_number ?? null, sensor_name: sensor?.name ?? null,
			site_id: d.site_id, site_name: d.site_name, parameter_id: sensor?.parameter_id ?? '',
			from: d.from, until: d.until,
		})),
	);
	const calMarkers = $derived<CalibrationMarker[]>(
		calibrations.map((c) => ({
			calibration_id: c.id, sensor_id: c.sensor_id, slope: c.slope, intercept: c.intercept,
			valid_from: c.valid_from, valid_until: c.valid_until,
		})),
	);
	const seriesTimes = $derived(series?.times.map((t) => new Date(t).getTime() / 1000) ?? []);

	// Sensor reading extent (ms) — full data span, bounds for calibration-window sliders.
	const seriesExtent = $derived.by(() => {
		const ds = series?.data_start ? new Date(series.data_start).getTime() : null;
		const de = series?.data_end ? new Date(series.data_end).getTime() : null;
		if (ds != null && de != null && de > ds) return { min: ds, max: de };
		const now = Date.now();
		return { min: now - 90 * 86400000, max: now };
	});

	// ─── Time control (parity with the site plot) ───
	let resolutionOverride = $state<'auto' | 'raw' | 'hourly' | 'daily'>('auto');
	let sliderMin = $state(Date.now() - 90 * 86400000);
	let sliderMax = $state(Date.now());
	let chartStart = $state(Date.now() - 604800000);
	let chartEnd = $state(Date.now());
	let showSensorVectors = $state(true);
	let showCalibrationMarkers = $state(true);
	let extentSeeded = false;
	let fetchGeneration = 0;
	let fetchTimer: ReturnType<typeof setTimeout> | null = null;
	let sliderRef = $state<{ setRange: (s: number, e: number) => void } | null>(null);

	function autoResolution(startMs: number, endMs: number): 'raw' | 'hourly' | 'daily' {
		const days = (endMs - startMs) / 86400000;
		if (days <= 14) return 'raw';
		if (days <= 120) return 'hourly';
		return 'daily';
	}
	const chartResolution = $derived<'raw' | 'hourly' | 'daily'>(
		resolutionOverride === 'auto' ? autoResolution(chartStart, chartEnd) : resolutionOverride,
	);
	const gapThreshold = $derived(GAP_THRESHOLDS[chartResolution] ?? 0);
	const windowLabel = $derived.by(() => {
		const days = (chartEnd - chartStart) / 86400000;
		if (days < 1) return `${Math.round(days * 24)}h`;
		if (days < 60) return `${Math.round(days)}d`;
		return `${(days / 30).toFixed(1)}mo`;
	});
	const activeRange = $derived.by(() => {
		const rangeMs: Record<string, number> = { '24h': 86400000, '7d': 604800000, '30d': 2592000000, '90d': 7776000000 };
		const dur = chartEnd - chartStart;
		for (const [key, ms] of Object.entries(rangeMs)) if (Math.abs(dur - ms) < 60000) return key;
		return null;
	});

	function scheduleFetch() {
		if (fetchTimer) clearTimeout(fetchTimer);
		fetchTimer = setTimeout(() => { fetchTimer = null; void fetchSeries(); }, 50);
	}

	async function fetchSeries() {
		seriesLoading = true;
		const gen = ++fetchGeneration;
		const startDate = new Date(chartStart).toISOString();
		const endDate = new Date(chartEnd).toISOString();
		try {
			const sr = await getSensorReadings(sensorId, {
				start: startDate, end: endDate, resolution: chartResolution, include_raw: true,
			});
			if (gen !== fetchGeneration) return;
			series = sr;
			// Seed slider bounds from the full data extent once.
			if (!extentSeeded && sr.data_start && sr.data_end) {
				sliderMin = new Date(sr.data_start).getTime();
				sliderMax = new Date(sr.data_end).getTime();
				if (chartStart < sliderMin) chartStart = sliderMin;
				if (chartEnd > sliderMax) chartEnd = sliderMax;
				extentSeeded = true;
			}
		} catch (e) {
			if (gen === fetchGeneration) toastStore.error(e instanceof Error ? `Failed to load sensor series: ${e.message}` : 'Failed to load sensor series');
		} finally {
			if (gen === fetchGeneration) seriesLoading = false;
		}
	}

	function updateChartRange(range: string) {
		const rangeMs: Record<string, number> = { '24h': 86400000, '7d': 604800000, '30d': 2592000000, '90d': 7776000000 };
		chartEnd = sliderMax;
		chartStart = Math.max(sliderMin, chartEnd - rangeMs[range]);
		scheduleFetch();
	}
	function onSliderChange(start: number, end: number) { chartStart = start; chartEnd = end; scheduleFetch(); }
	function onChartZoomSelect(startMs: number, endMs: number) {
		chartStart = startMs; chartEnd = endMs;
		sliderRef?.setRange(startMs, endMs);
		scheduleFetch();
	}
	function onChartResetZoom() {
		chartStart = sliderMin; chartEnd = sliderMax;
		sliderRef?.setRange(sliderMin, sliderMax);
		scheduleFetch();
	}

	const msToLocal = (ms: number) => new Date(ms).toISOString().slice(0, 16);
	const localToMs = (s: string) => new Date(s).getTime();

	// Add-calibration dialog
	let addCalOpen = $state(false);
	let newCalFromMs = $state(Date.now());
	let newCalEndMs = $state(0);
	$effect(() => { if (newCalEndMs === 0 && seriesExtent.max > 0) newCalEndMs = seriesExtent.max; });
	let newCalSlope = $state('1');
	let newCalIntercept = $state('0');
	let addingCal = $state(false);

	// Deploy / move dialog
	let deployOpen = $state(false);
	const currentDeployment = $derived(deployments.find((d) => !d.deployed_until));

	async function reloadDeployments() {
		const deps = await api.sensorDeployments.list({
			perPage: 100,
			filter: { sensor_id: sensorId },
			sort: ['deployed_from', 'DESC'],
		});
		deployments = deps.data;
	}

	async function reloadCalibrations() {
		const cals = await api.sensorCalibrations.list({
			perPage: 100,
			filter: { sensor_id: sensorId },
			sort: ['valid_from', 'DESC'],
		});
		calibrations = cals.data;
	}

	async function handleAddCalibration() {
		const slope = Number(newCalSlope);
		const intercept = Number(newCalIntercept);
		if (!Number.isFinite(slope) || slope === 0) {
			toastStore.error('Slope must be a non-zero number');
			return;
		}
		if (!Number.isFinite(intercept)) {
			toastStore.error('Intercept must be a number');
			return;
		}
		addingCal = true;
		try {
			await api.sensorCalibrations.create({
				sensor_id: sensorId,
				valid_from: new Date(newCalFromMs).toISOString(),
				slope,
				intercept,
			});
			toastStore.success('Calibration added — readings will be recomputed in the background');
			addCalOpen = false;
			newCalSlope = '1';
			newCalIntercept = '0';
			newCalFromMs = Date.now();
			await reloadCalibrations();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to add calibration');
		} finally {
			addingCal = false;
		}
	}

	onMount(async () => {
		// Deep link from a chart band/calibration-marker click: ?tab=calibrations&cal=<id>
		if (page.url.searchParams.get('tab') === 'calibrations') activeTab = 2;
		const calParam = page.url.searchParams.get('cal');
		if (calParam) editingCalId = calParam;

		try {
			const [s, cals, deps, sitesResult, params] = await Promise.all([
				api.sensors.get(sensorId),
				api.sensorCalibrations.list({ perPage: 100, filter: { sensor_id: sensorId }, sort: ['valid_from', 'DESC'] }),
				api.sensorDeployments.list({ perPage: 100, filter: { sensor_id: sensorId }, sort: ['deployed_from', 'DESC'] }),
				api.sites.list({ perPage: 200 }),
				api.parameters.list({ perPage: 500 }),
			]);
			sensor = s;
			calibrations = cals.data;
			deployments = deps.data;
			sites = sitesResult.data;
			parameters = params.data;
		} finally {
			loading = false;
		}
		try {
			const db = await getSensorDeploymentBands(sensorId);
			depBands = db.bands;
		} catch { /* bands are non-critical */ }
		void fetchSeries();
	});

	function siteName(siteId: string): string {
		return sites.find((s) => s.id === siteId)?.name ?? siteId;
	}

	async function handleRecalibrate(calId: string) {
		try {
			await recalibrateCalibration(calId);
			toastStore.success('Recalibration triggered');
		} catch { toastStore.error('Recalibration failed'); }
	}

	async function handleRollback(depId: string) {
		try {
			const result = await rollbackDeployment(depId);
			toastStore.success(`Rolled back: ${result.readings_reassigned} readings reassigned`);
			await reloadDeployments();
		} catch { toastStore.error('Rollback failed'); }
	}

	async function handleRecall(depId: string) {
		try {
			await api.sensorDeployments.update(depId, { deployed_until: new Date().toISOString() });
			toastStore.success('Sensor recalled — readings will be re-coordinated in the background');
			await reloadDeployments();
		} catch (e) { toastStore.error(e instanceof Error ? e.message : 'Recall failed'); }
	}

	async function handleReprocess() {
		try {
			await reprocessSensor(sensorId);
			toastStore.success('Reprocessing started — track it in the Operations indicator');
		} catch (e) { toastStore.error(e instanceof Error ? e.message : 'Reprocess failed'); }
	}

	// Unattributed history exists when the slot's earliest reading (any sensor) predates the open
	// deployment's start. Backdating deployed_from to it lets the slot reprocess claim those rows.
	// (Use slot_data_start, NOT data_start — data_start only sees readings already attributed to
	// this sensor, so it can never reveal the orphaned history.)
	const needsBackdate = $derived(
		!!series?.slot_data_start && !!currentDeployment &&
		new Date(series.slot_data_start).getTime() < new Date(currentDeployment.deployed_from).getTime() - 60000,
	);
	let backdating = $state(false);
	async function backdateToFirstReading() {
		if (!currentDeployment || !series?.slot_data_start) return;
		backdating = true;
		try {
			await api.sensorDeployments.update(currentDeployment.id, { deployed_from: series.slot_data_start });
			toastStore.success('Deployment backdated — historical readings are being attributed in the background');
			await reloadDeployments();
			scheduleFetch();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Backdate failed');
		} finally {
			backdating = false;
		}
	}

	// Inline deployment date editing (Deployments tab).
	let editingDepId = $state<string | null>(null);
	let editDepFrom = $state('');
	let editDepUntil = $state('');
	let savingDep = $state(false);
	function startEditDep(dep: SensorDeployment) {
		editingDepId = dep.id;
		editDepFrom = dep.deployed_from.slice(0, 16);
		editDepUntil = dep.deployed_until ? dep.deployed_until.slice(0, 16) : '';
	}
	async function saveDep(depId: string) {
		if (!editDepFrom) { toastStore.error('Deployed from is required'); return; }
		savingDep = true;
		try {
			await api.sensorDeployments.update(depId, {
				deployed_from: new Date(editDepFrom).toISOString(),
				deployed_until: editDepUntil ? new Date(editDepUntil).toISOString() : null,
			});
			toastStore.success('Deployment dates updated — readings re-attributed in the background');
			editingDepId = null;
			await reloadDeployments();
			scheduleFetch();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Update failed');
		} finally {
			savingDep = false;
		}
	}
</script>

<svelte:head><title>{sensor?.name ?? sensor?.serial_number ?? 'Sensor'} | River Data</title></svelte:head>

{#if loading}
	<p class="text-brand-muted">Loading...</p>
{:else if sensor}
	<div class="space-y-4">
		<div class="flex items-center justify-between">
			<div>
				<a href="{base}/sensors" class="text-sm text-brand-muted hover:text-brand-primary no-underline">&larr; Sensors</a>
				<h2 class="text-xl font-semibold mt-1">{sensor.name ?? sensor.serial_number ?? 'Sensor'}</h2>
				{#if sensor.manufacturer || sensor.model}
					<p class="text-sm text-brand-muted">{[sensor.manufacturer, sensor.model].filter(Boolean).join(' ')}</p>
				{/if}
				{#if currentDeployment}
					<p class="text-sm mt-0.5">Currently at <a href="{base}/sites/{currentDeployment.site_id}" class="text-brand-primary no-underline hover:underline">{siteName(currentDeployment.site_id)}</a> since {formatDateTime(currentDeployment.deployed_from)}</p>
				{:else}
					<p class="text-sm mt-0.5 text-brand-muted">Not currently deployed</p>
				{/if}
			</div>
			<div class="flex gap-2 items-center">
				<button onclick={() => (adoptOpen = true)} class="px-3 py-1 text-sm border border-brand-divider rounded-md cursor-pointer bg-brand-surface hover:bg-brand-bg">Add data…</button>
				<ConfirmPopover message="Reprocess all of this sensor's readings? Re-derives calibration and deployment by time window." confirmLabel="Reprocess" confirmVariant="primary" onconfirm={handleReprocess}>
					<button class="px-3 py-1 text-sm border border-brand-divider rounded-md cursor-pointer bg-brand-surface hover:bg-brand-bg">Reprocess</button>
				</ConfirmPopover>
				<button onclick={() => (deployOpen = true)} class="px-3 py-1 text-sm border border-brand-divider rounded-md cursor-pointer bg-brand-surface hover:bg-brand-bg">Deploy / Move…</button>
				<span class="px-2 py-0.5 text-xs font-medium rounded-full {sensor.is_active ? 'bg-severity-ok-soft text-severity-ok' : 'bg-brand-bg text-brand-muted'}">
					{sensor.is_active ? 'Active' : 'Inactive'}
				</span>
			</div>
		</div>

		<Tabs tabs={['Overview', 'Deployments', 'Calibrations']} bind:active={activeTab} />

		{#if activeTab === 0}
			{#if needsBackdate && currentDeployment}
				<div class="flex items-center gap-3 px-3 py-2 text-sm bg-brand-primary/5 text-brand-primary rounded-md border border-brand-primary/20">
					<span>Readings exist before this deployment started ({formatDateTime(currentDeployment.deployed_from)}) — they aren't attributed to this sensor.</span>
					<button onclick={backdateToFirstReading} disabled={backdating} class="ml-auto px-2 py-0.5 text-xs bg-brand-primary text-white rounded cursor-pointer border-none disabled:opacity-50 whitespace-nowrap">{backdating ? 'Backdating…' : 'Backdate to first reading'}</button>
				</div>
			{/if}
			<div class="rounded-md border border-brand-divider bg-brand-surface px-4 py-3 space-y-3">
				<div class="flex items-center gap-3 flex-wrap">
					<span class="text-xs text-brand-muted font-semibold uppercase tracking-wider">Range</span>
					<div class="flex gap-0.5">
						{#each ['24h', '7d', '30d', '90d'] as range}
							<button
								onclick={() => updateChartRange(range)}
								class="px-2.5 py-1 text-xs rounded cursor-pointer border-none {activeRange === range ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted hover:text-brand-text'}"
							>{range}</button>
						{/each}
					</div>

					<div class="w-px h-5 bg-brand-divider mx-1"></div>

					<span class="text-xs text-brand-muted font-semibold uppercase tracking-wider">Resolution</span>
					<div class="flex gap-0.5">
						{#each [['auto', 'Auto'], ['raw', 'Raw'], ['hourly', 'Hourly'], ['daily', 'Daily']] as [val, label]}
							<button
								onclick={() => { resolutionOverride = val as typeof resolutionOverride; scheduleFetch(); }}
								class="px-2 py-1 text-xs rounded cursor-pointer border-none {resolutionOverride === val ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted hover:text-brand-text'}"
							>{label}{resolutionOverride === 'auto' && val === 'auto' ? ` (${chartResolution})` : ''}</button>
						{/each}
					</div>

					<div class="w-px h-5 bg-brand-divider mx-1"></div>
					<label class="flex items-center gap-1.5 cursor-pointer text-xs text-brand-muted" title="Colour the time axis by which site the sensor was deployed at">
						<input type="checkbox" bind:checked={showSensorVectors} /> Site bands
					</label>
					<label class="flex items-center gap-1.5 cursor-pointer text-xs text-brand-muted" title="Mark calibration changes">
						<input type="checkbox" bind:checked={showCalibrationMarkers} /> Calibration markers
					</label>

					<span class="text-xs text-brand-muted ml-auto font-mono">
						{windowLabel} · {new Date(chartStart).toLocaleDateString()} — {new Date(chartEnd).toLocaleDateString()}
					</span>
				</div>
				<TimeRangeSlider
					bind:this={sliderRef}
					min={sliderMin}
					max={sliderMax}
					bind:start={chartStart}
					bind:end={chartEnd}
					onchange={onSliderChange}
				/>
			</div>

			{#if !seriesLoading || series}
				<SensorSeriesChart
					times={seriesTimes}
					raw={series?.raw ?? []}
					calibrated={series?.calibrated ?? []}
					rawMin={series?.raw_min ?? []}
					rawMax={series?.raw_max ?? []}
					calMin={series?.calibrated_min ?? []}
					calMax={series?.calibrated_max ?? []}
					units={sensorUnits}
					deploymentBands={identityBands}
					calibrationMarkers={calMarkers}
					{showSensorVectors}
					{showCalibrationMarkers}
					{gapThreshold}
					onZoomSelect={onChartZoomSelect}
					onResetZoom={onChartResetZoom}
				/>
			{:else}
				<div class="rounded-md border border-brand-divider bg-brand-surface p-6 text-center text-sm text-brand-muted">Loading series…</div>
			{/if}
			<div class="rounded-md border border-brand-divider bg-brand-surface p-4 space-y-3 max-w-xl">
				<div class="grid grid-cols-2 gap-4 text-sm">
					<div><span class="text-brand-muted block">Serial Number</span><span class="font-mono">{sensor.serial_number ?? '—'}</span></div>
					<div><span class="text-brand-muted block">Name</span>{sensor.name ?? '—'}</div>
					<div><span class="text-brand-muted block">Manufacturer</span>{sensor.manufacturer ?? '—'}</div>
					<div><span class="text-brand-muted block">Model</span>{sensor.model ?? '—'}</div>
				</div>
				{#if sensor.notes}
					<div><span class="text-sm text-brand-muted block">Notes</span><p class="text-sm">{sensor.notes}</p></div>
				{/if}
			</div>
		{:else if activeTab === 1}
			<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
				<table class="w-full text-sm">
					<thead><tr class="bg-brand-bg border-b border-brand-divider">
						<th class="text-left px-4 py-2 font-semibold">Site</th>
						<th class="text-left px-4 py-2 font-semibold">From</th>
						<th class="text-left px-4 py-2 font-semibold">Until</th>
						<th class="text-left px-4 py-2 font-semibold">Actions</th>
					</tr></thead>
					<tbody>
						{#each deployments as dep}
							<tr class="border-b border-brand-divider last:border-b-0">
								<td class="px-4 py-2"><a href="{base}/sites/{dep.site_id}" class="text-brand-primary no-underline hover:underline">{siteName(dep.site_id)}</a></td>
								<td class="px-4 py-2 text-xs text-brand-muted">{formatDateTime(dep.deployed_from)}</td>
								<td class="px-4 py-2 text-xs text-brand-muted">{dep.deployed_until ? formatDateTime(dep.deployed_until) : 'Current'}</td>
								<td class="px-4 py-2">
									<div class="flex gap-3">
										<button class="text-xs text-brand-primary bg-transparent border-none cursor-pointer hover:underline" onclick={() => editingDepId === dep.id ? (editingDepId = null) : startEditDep(dep)}>{editingDepId === dep.id ? 'Close' : 'Edit dates'}</button>
										{#if !dep.deployed_until}
											<ConfirmPopover message="End this deployment now? The sensor will be marked as no longer in the field." confirmLabel="Recall" confirmVariant="primary" onconfirm={() => handleRecall(dep.id)}>
												<button class="text-xs text-brand-primary bg-transparent border-none cursor-pointer hover:underline">Recall</button>
											</ConfirmPopover>
											<ConfirmPopover message="Roll back this deployment? This deletes it and restores the previous one." confirmLabel="Rollback" onconfirm={() => handleRollback(dep.id)}>
												<button class="text-xs text-severity-alarm bg-transparent border-none cursor-pointer hover:underline">Rollback</button>
											</ConfirmPopover>
										{/if}
									</div>
								</td>
							</tr>
							{#if editingDepId === dep.id}
								<tr class="border-b border-brand-divider bg-brand-bg/40">
									<td colspan="4" class="px-4 py-3">
										<div class="flex items-end gap-3 flex-wrap">
											<label class="flex flex-col gap-1 text-xs text-brand-muted">Deployed from<input type="datetime-local" bind:value={editDepFrom} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm" /></label>
											<label class="flex flex-col gap-1 text-xs text-brand-muted">Deployed until <span class="text-[10px]">(blank = open)</span><input type="datetime-local" bind:value={editDepUntil} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm" /></label>
											<button onclick={() => saveDep(dep.id)} disabled={savingDep} class="px-3 py-1 text-sm bg-brand-primary text-white rounded-md cursor-pointer border-none disabled:opacity-50">{savingDep ? 'Saving…' : 'Save & reprocess'}</button>
											<span class="text-[11px] text-brand-muted">Changing dates re-attributes readings in the affected range in the background.</span>
										</div>
									</td>
								</tr>
							{/if}
						{/each}
						{#if deployments.length === 0}
							<tr><td colspan="4" class="px-4 py-6 text-center text-brand-muted">No deployments</td></tr>
						{/if}
					</tbody>
				</table>
			</div>
		{:else if activeTab === 2}
			<div class="flex justify-end mb-2">
				<button onclick={() => addCalOpen = true} class="px-3 py-1 text-sm bg-brand-primary text-white rounded-md cursor-pointer border-none">+ Add Calibration</button>
			</div>
			<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
				<table class="w-full text-sm">
					<thead><tr class="bg-brand-bg border-b border-brand-divider">
						<th class="text-left px-4 py-2 font-semibold">Valid From</th>
						<th class="text-left px-4 py-2 font-semibold">Valid Until</th>
						<th class="text-left px-4 py-2 font-semibold">Slope</th>
						<th class="text-left px-4 py-2 font-semibold">Intercept</th>
						<th class="text-left px-4 py-2 font-semibold">Equation</th>
						<th class="text-left px-4 py-2 font-semibold">Actions</th>
					</tr></thead>
					<tbody>
						{#each calibrations as cal}
							<tr class="border-b border-brand-divider last:border-b-0">
								<td class="px-4 py-2 text-xs">{formatDateTime(cal.valid_from)}</td>
								<td class="px-4 py-2 text-xs text-brand-muted">{cal.valid_until ? formatDateTime(cal.valid_until) : '—'}</td>
								<td class="px-4 py-2 font-mono text-xs">{cal.slope}</td>
								<td class="px-4 py-2 font-mono text-xs">{cal.intercept}</td>
								<td class="px-4 py-2 font-mono text-xs">y = {cal.slope}x + {cal.intercept}</td>
								<td class="px-4 py-2 space-x-3">
									<button class="text-xs text-brand-primary bg-transparent border-none cursor-pointer hover:underline" onclick={() => editingCalId = editingCalId === cal.id ? null : cal.id}>{editingCalId === cal.id ? 'Close' : 'Edit window'}</button>
									<ConfirmPopover message="Recalibrate readings?" confirmLabel="Recalibrate" confirmVariant="primary" onconfirm={() => handleRecalibrate(cal.id)}>
										<button class="text-xs text-brand-primary bg-transparent border-none cursor-pointer hover:underline">Recalibrate</button>
									</ConfirmPopover>
								</td>
							</tr>
							{#if editingCalId === cal.id}
								<tr class="border-b border-brand-divider bg-brand-bg/40">
									<td colspan="6" class="px-4 py-3">
										<CalibrationWindowEditor calibration={cal} units={sensorUnits} rangeMin={seriesExtent.min} rangeMax={seriesExtent.max} onchanged={reloadCalibrations} />
									</td>
								</tr>
							{/if}
						{/each}
						{#if calibrations.length === 0}
							<tr><td colspan="6" class="px-4 py-6 text-center text-brand-muted">No calibrations</td></tr>
						{/if}
					</tbody>
				</table>
			</div>
		{/if}
	</div>

	<Dialog bind:open={addCalOpen} title="Add Calibration" maxWidth="sm">
		{#snippet children()}
			<div class="space-y-3">
				<div class="flex flex-col gap-1">
					<label for="cal-valid-from" class="text-xs text-brand-muted">Valid from</label>
					<input id="cal-valid-from" type="datetime-local" value={msToLocal(newCalFromMs)} oninput={(e) => newCalFromMs = localToMs(e.currentTarget.value)} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
					{#if seriesExtent.max > seriesExtent.min}
						<TimeRangeSlider min={seriesExtent.min} max={seriesExtent.max} bind:start={newCalFromMs} bind:end={newCalEndMs} />
						<span class="text-[10px] text-brand-muted">Drag the left handle to set when this calibration takes effect. It applies until the next calibration starts.</span>
					{/if}
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div class="flex flex-col gap-1">
						<label for="cal-slope" class="text-xs text-brand-muted">Slope (m)</label>
						<input id="cal-slope" type="number" step="any" bind:value={newCalSlope} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
					</div>
					<div class="flex flex-col gap-1">
						<label for="cal-intercept" class="text-xs text-brand-muted">Intercept (b)</label>
						<input id="cal-intercept" type="number" step="any" bind:value={newCalIntercept} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
					</div>
				</div>
				<p class="text-xs text-brand-muted">Calibrated value = slope &times; raw + intercept. Adding this calibration will recompute existing readings in its time window in the background.</p>
			</div>
		{/snippet}
		{#snippet actions()}
			<button onclick={() => addCalOpen = false} class="px-3 py-1.5 border border-brand-divider rounded-md text-sm cursor-pointer bg-brand-surface">Cancel</button>
			<button onclick={handleAddCalibration} disabled={addingCal} class="px-3 py-1.5 bg-brand-primary text-white rounded-md text-sm cursor-pointer border-none disabled:opacity-50">{addingCal ? 'Adding...' : 'Add'}</button>
		{/snippet}
	</Dialog>

	<DeployMoveSensorDialog
		bind:open={deployOpen}
		mode="sensor"
		sensorId={sensor.id}
		sensorName={sensor.name ?? sensor.serial_number ?? 'sensor'}
		sites={sites}
		currentSiteName={currentDeployment ? siteName(currentDeployment.site_id) : ''}
		onsuccess={reloadDeployments}
	/>

	{#if sensor}
		<AdoptSensorDialog bind:open={adoptOpen} {sensor} {sites} {parameters} onsuccess={reloadDeployments} />
	{/if}
{/if}
