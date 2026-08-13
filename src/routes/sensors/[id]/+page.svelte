<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { api, type Sensor, type SensorCalibration, type SensorDeployment, type Site, type Parameter } from '$api/crud';
	import { recalibrateCalibration, rollbackDeployment, reprocessSensor, retagSensorFrequency, getCalibrationCandidates } from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatDateTime, formatDate, toDatetimeLocal, fromDatetimeLocal } from '$lib/utils';
	import { timezoneStore } from '$lib/stores/timezone.svelte';
	import Button from '$components/ui/Button.svelte';
	import Tabs from '$components/ui/Tabs.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import Breadcrumbs from '$components/ui/Breadcrumbs.svelte';
	import DeployMoveSensorDialog from '$components/dialogs/DeployMoveSensorDialog.svelte';
	import SensorSeriesChart from '$components/charts/SensorSeriesChart.svelte';
	import CalibrationWindowEditor from '$components/charts/CalibrationWindowEditor.svelte';
	import TimeRangeSlider from '$components/charts/TimeRangeSlider.svelte';
	import AdoptSensorDialog from '$components/dialogs/AdoptSensorDialog.svelte';
	import StandardCurvesTab from '$components/sensors/StandardCurvesTab.svelte';
	import { createUrlTab } from '$lib/urlTab.svelte';
	import { getSensorReadings, getSensorDeploymentBands, type SensorReadingsResponse, type SensorDeploymentBand } from '$api/sensors';
	import type { SensorIdentityBand, CalibrationMarker } from '$api/sensors';
	import { GAP_THRESHOLDS } from '$lib/charts/uPlotTheme';

	let sensor = $state<Sensor | null>(null);
	let calibrations = $state<SensorCalibration[]>([]);
	let deployments = $state<SensorDeployment[]>([]);
	let sites = $state<Site[]>([]);
	let loading = $state(true);
	let uncalibratedCount = $state(0);

	// Deep links land here from chart markers (?tab=calibrations&cal=<id>) and from a reading's
	// standard-curve reference (?tab=curves&curve=<id>); urlTab preserves those extra params.
	const tab = createUrlTab({ keys: ['overview', 'deployments', 'calibrations', 'curves'] });

	let parameters = $state<Parameter[]>([]);
	let series = $state<SensorReadingsResponse | null>(null);
	let depBands = $state<SensorDeploymentBand[]>([]);
	let seriesLoading = $state(true);
	let adoptOpen = $state(false);
	let editingCalId = $state<string | null>(null);

	const sensorId = page.params.id!;

	const sensorUnits = $derived(series?.units ?? '');

	// Adapt deployment bands → the SensorIdentityBand shape the chart plugin expects.
	const identityBands = $derived<SensorIdentityBand[]>(
		depBands.map((d) => ({
			deployment_id: d.deployment_id, sensor_id: sensorId,
			sensor_serial: sensor?.serial_number ?? null, sensor_name: sensor?.name ?? null,
			site_id: d.site_id, site_name: d.site_name, parameter_id: series?.parameter_id ?? '',
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

	// Sensor reading extent (ms) - full data span, bounds for calibration-window sliders.
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
	let addCalOpen = $state(false);

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
		await loadUncalibratedCount();
	}

	async function loadUncalibratedCount() {
		try {
			const res = await getCalibrationCandidates();
			const match = res.candidates.find((c) => c.sensor_id === sensorId);
			uncalibratedCount = match?.uncalibrated_count ?? 0;
		} catch {
			uncalibratedCount = 0;
		}
	}

	const focusCurveId = page.url.searchParams.get('curve');

	onMount(async () => {
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
		void loadUncalibratedCount();
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
			toastStore.success('Sensor recalled - readings will be re-coordinated in the background');
			await reloadDeployments();
		} catch (e) { toastStore.error(e instanceof Error ? e.message : 'Recall failed'); }
	}

	async function handleReprocess() {
		try {
			await reprocessSensor(sensorId);
			toastStore.success('Reprocessing started - track it in the Operations indicator');
		} catch (e) { toastStore.error(e instanceof Error ? e.message : 'Reprocess failed'); }
	}

	// Flip the low/high data-frequency classification; existing readings are retagged by a tracked
	// job (spot data renders as points and stays out of hourly/daily averages).
	async function toggleFrequency() {
		if (!sensor) return;
		const next = sensor.data_frequency === 'low' ? 'high' : 'low';
		try {
			await retagSensorFrequency([sensorId], next, true);
			sensor = { ...sensor, data_frequency: next };
			toastStore.success(`Marked ${next}-frequency; existing readings are being retagged`);
		} catch (e) { toastStore.error(e instanceof Error ? e.message : 'Reclassification failed'); }
	}

	// Unattributed history exists when the slot's earliest reading (any sensor) predates the open
	// deployment's start. Backdating deployed_from to it lets the slot reprocess claim those rows.
	// (Use slot_data_start, NOT data_start - data_start only sees readings already attributed to
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
			toastStore.success('Deployment backdated - historical readings are being attributed in the background');
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
		editDepFrom = toDatetimeLocal(dep.deployed_from, timezoneStore.zone);
		editDepUntil = dep.deployed_until ? toDatetimeLocal(dep.deployed_until, timezoneStore.zone) : '';
	}
	async function saveDep(depId: string) {
		if (!editDepFrom) { toastStore.error('Deployed from is required'); return; }
		savingDep = true;
		try {
			await api.sensorDeployments.update(depId, {
				deployed_from: fromDatetimeLocal(editDepFrom, timezoneStore.zone),
				deployed_until: editDepUntil ? fromDatetimeLocal(editDepUntil, timezoneStore.zone) : null,
			});
			toastStore.success('Deployment dates updated - readings re-attributed in the background');
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
	<p class="text-brand-muted">Loading…</p>
{:else if sensor}
	<div class="space-y-4">
		<div class="flex items-center justify-between">
			<div>
				<Breadcrumbs items={[{ label: 'Sensors', href: `${base}/sensors` }]} />
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
				<ConfirmPopover
					message={sensor.data_frequency === 'low'
						? 'Mark this instrument high-frequency? Its readings become continuous data and re-enter the hourly/daily averages.'
						: 'Mark this instrument low-frequency? Its readings become spot data (shown as points, excluded from hourly/daily averages).'}
					confirmLabel={sensor.data_frequency === 'low' ? 'Mark high-frequency' : 'Mark low-frequency'}
					confirmVariant="primary"
					onconfirm={toggleFrequency}
				>
					<Button variant="ghost">{sensor.data_frequency === 'low' ? 'Low frequency' : 'High frequency'}</Button>
				</ConfirmPopover>
				<Button onclick={() => (adoptOpen = true)}>Add data…</Button>
				<ConfirmPopover message="Reprocess all of this sensor's readings? Re-derives calibration and deployment by time window." confirmLabel="Reprocess" confirmVariant="primary" onconfirm={handleReprocess}>
					<Button>Reprocess</Button>
				</ConfirmPopover>
				<Button onclick={() => (deployOpen = true)}>Deploy / Move…</Button>
				<span class="px-2 py-0.5 text-xs font-medium rounded-full {sensor.is_active ? 'bg-severity-ok-soft text-severity-ok' : 'bg-brand-bg text-brand-muted'}">
					{sensor.is_active ? 'Active' : 'Inactive'}
				</span>
			</div>
		</div>

		<Tabs tabs={['Overview', 'Deployments', 'Calibrations', 'Standard curves']} bind:active={tab.index} />

		{#if tab.key === 'overview'}
			{#if needsBackdate && currentDeployment}
				<div class="flex items-center gap-3 px-3 py-2 text-sm bg-brand-primary/5 text-brand-primary rounded-md border border-brand-primary/20">
					<span>Readings exist before this deployment started ({formatDateTime(currentDeployment.deployed_from)}) - they aren't attributed to this sensor.</span>
					<Button variant="primary" size="sm" class="ml-auto whitespace-nowrap" onclick={backdateToFirstReading} disabled={backdating}>{backdating ? 'Backdating…' : 'Backdate to first reading'}</Button>
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
						{windowLabel} · {formatDate(new Date(chartStart))} - {formatDate(new Date(chartEnd))}
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
					onCalibrationClick={(m) => { tab.go('calibrations'); editingCalId = m.calibration_id; }}
				/>
			{:else}
				<div class="rounded-md border border-brand-divider bg-brand-surface p-6 text-center text-sm text-brand-muted">Loading series…</div>
			{/if}
			<div class="rounded-md border border-brand-divider bg-brand-surface p-4 space-y-3 max-w-xl">
				<div class="grid grid-cols-2 gap-4 text-sm">
					<div><span class="text-brand-muted block">Serial Number</span><span class="font-mono">{sensor.serial_number ?? 'None'}</span></div>
					<div><span class="text-brand-muted block">Name</span>{sensor.name ?? 'None'}</div>
					<div><span class="text-brand-muted block">Manufacturer</span>{sensor.manufacturer ?? 'None'}</div>
					<div><span class="text-brand-muted block">Model</span>{sensor.model ?? 'None'}</div>
				</div>
				{#if sensor.notes}
					<div><span class="text-sm text-brand-muted block">Notes</span><p class="text-sm">{sensor.notes}</p></div>
				{/if}
			</div>
		{:else if tab.key === 'deployments'}
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
										<Button variant="ghost" size="sm" class="text-brand-primary" onclick={() => editingDepId === dep.id ? (editingDepId = null) : startEditDep(dep)}>{editingDepId === dep.id ? 'Close' : 'Edit dates'}</Button>
										{#if !dep.deployed_until}
											<ConfirmPopover message="End this deployment now? The sensor will be marked as no longer in the field." confirmLabel="Recall" confirmVariant="primary" onconfirm={() => handleRecall(dep.id)}>
												<Button variant="ghost" size="sm" class="text-brand-primary">Recall</Button>
											</ConfirmPopover>
											<ConfirmPopover message="Roll back this deployment? This deletes it and restores the previous one." confirmLabel="Rollback" onconfirm={() => handleRollback(dep.id)}>
												<Button variant="ghost" size="sm" class="text-severity-alarm">Rollback</Button>
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
											<Button variant="primary" onclick={() => saveDep(dep.id)} disabled={savingDep}>{savingDep ? 'Saving…' : 'Save & reprocess'}</Button>
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
		{:else if tab.key === 'calibrations'}
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
					deploymentBands={[]}
					calibrationMarkers={calMarkers}
					showSensorVectors={false}
					showCalibrationMarkers={true}
					{gapThreshold}
					height={240}
					onZoomSelect={onChartZoomSelect}
					onResetZoom={onChartResetZoom}
					onCalibrationClick={(m) => {
						const from = new Date(m.valid_from).getTime();
						const until = m.valid_until ? new Date(m.valid_until).getTime() : sliderMax;
						chartStart = from;
						chartEnd = until;
						sliderRef?.setRange(from, until);
						scheduleFetch();
					}}
				/>
			{/if}
			{#if uncalibratedCount > 0}
				<div class="rounded-md bg-brand-bg border border-brand-divider px-3 py-2 mb-2 text-xs text-brand-muted">
					{uncalibratedCount.toLocaleString()} reading{uncalibratedCount === 1 ? '' : 's'} sit inside one of these windows but were never stamped with it. Reprocess the sensor to resolve them.
				</div>
			{/if}
			<div class="flex justify-end mb-2">
				<button onclick={() => addCalOpen = !addCalOpen} class="px-3 py-1 text-sm {addCalOpen ? 'bg-brand-bg text-brand-muted border border-brand-divider' : 'bg-brand-primary text-white border-none'} rounded-md cursor-pointer">{addCalOpen ? 'Cancel' : '+ Add Calibration'}</button>
			</div>
			{#if addCalOpen}
				<div class="rounded-md border border-brand-primary/30 bg-brand-primary/5 p-4 mb-3">
					<h3 class="text-sm font-semibold mb-2">New Calibration</h3>
					<CalibrationWindowEditor
						mode="create"
						allCalibrations={calibrations}
						units={sensorUnits}
						{sensorId}
						rangeMin={seriesExtent.min}
						rangeMax={seriesExtent.max}
						onchanged={() => { addCalOpen = false; reloadCalibrations(); }}
					/>
				</div>
			{/if}
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
								<td class="px-4 py-2 text-xs text-brand-muted">{cal.valid_until ? formatDateTime(cal.valid_until) : 'None'}</td>
								<td class="px-4 py-2 font-mono text-xs">{cal.slope}</td>
								<td class="px-4 py-2 font-mono text-xs">{cal.intercept}</td>
								<td class="px-4 py-2 font-mono text-xs">y = {cal.slope}x + {cal.intercept}</td>
								<td class="px-4 py-2 space-x-3">
									<Button variant="ghost" size="sm" class="text-brand-primary" onclick={() => editingCalId = editingCalId === cal.id ? null : cal.id}>{editingCalId === cal.id ? 'Close' : 'Edit window'}</Button>
									<Button variant="ghost" size="sm" class="text-brand-primary" onclick={() => handleRecalibrate(cal.id)}>Reprocess</Button>
								</td>
							</tr>
							{#if editingCalId === cal.id}
								<tr class="border-b border-brand-divider bg-brand-bg/40">
									<td colspan="6" class="px-4 py-3">
										<CalibrationWindowEditor calibration={cal} allCalibrations={calibrations} units={sensorUnits} {sensorId} rangeMin={seriesExtent.min} rangeMax={seriesExtent.max} onchanged={reloadCalibrations} onswitchcalibration={(id) => editingCalId = id} />
									</td>
								</tr>
							{/if}
						{/each}
						{#if calibrations.length === 0}
							<tr><td colspan="6" class="px-4 py-6 text-center text-brand-muted">No calibrations recorded - readings are served uncorrected until a curve is entered.</td></tr>
						{/if}
					</tbody>
				</table>
			</div>
		{:else if tab.key === 'curves'}
			<StandardCurvesTab
				{sensorId}
				sensorName={sensor.name ?? sensor.serial_number ?? 'this instrument'}
				{focusCurveId}
			/>
		{/if}
	</div>

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
