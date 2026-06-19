<script lang="ts">
	import { api, type SensorCalibration } from '$api/crud';
	import { recalibrateCalibration } from '$api/service';
	import { getSensorReadings, type SensorReadingsResponse } from '$api/sensors';
	import type { CalibrationMarker } from '$api/sensors';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { toDatetimeLocal, fromDatetimeLocal } from '$lib/utils';
	import { timezoneStore } from '$lib/stores/timezone.svelte';
	import { GAP_THRESHOLDS } from '$lib/charts/uPlotTheme';
	import ScatterPlot from '$components/charts/ScatterPlot.svelte';
	import SensorSeriesChart from '$components/charts/SensorSeriesChart.svelte';
	import TimeRangeSlider from '$components/charts/TimeRangeSlider.svelte';
	import Button from '$components/ui/Button.svelte';

	let { mode = 'edit', calibration, allCalibrations = [], units = '', sensorId, rangeMin, rangeMax, onchanged, onswitchcalibration }: {
		mode?: 'edit' | 'create';
		calibration?: SensorCalibration;
		allCalibrations?: SensorCalibration[];
		units?: string;
		sensorId: string;
		rangeMin: number;
		rangeMax: number;
		onchanged?: () => void;
		onswitchcalibration?: (calibrationId: string) => void;
	} = $props();

	let slope = $state(calibration ? String(calibration.slope) : '1');
	let intercept = $state(calibration ? String(calibration.intercept) : '0');
	let saving = $state(false);

	const initFrom = calibration
		? Math.min(Math.max(new Date(calibration.valid_from).getTime(), rangeMin), rangeMax)
		: Math.max(rangeMin, rangeMax - 30 * 86400000);
	const initUntil = calibration?.valid_until ? new Date(calibration.valid_until).getTime() : rangeMax;
	let startMs = $state(initFrom);
	let endMs = $state(Math.min(Math.max(initUntil, rangeMin), rangeMax));

	const OPEN_EPS = 60_000;
	const isOpenEnded = $derived(endMs >= rangeMax - OPEN_EPS);

	const msToLocal = (ms: number) => toDatetimeLocal(ms, timezoneStore.zone);
	const localToMs = (s: string) => new Date(fromDatetimeLocal(s, timezoneStore.zone)).getTime();

	// ─── Chart data explorer ───
	let resolutionOverride = $state<'auto' | 'raw' | 'hourly' | 'daily'>('auto');
	let series = $state<SensorReadingsResponse | null>(null);
	let seriesLoading = $state(false);
	let fetchGeneration = 0;
	let fetchTimer: ReturnType<typeof setTimeout> | null = null;
	let sliderRef = $state<{ setRange: (s: number, e: number) => void } | null>(null);

	const calFromMs = calibration ? new Date(calibration.valid_from).getTime() : initFrom;
	let chartStart = $state(Math.max(rangeMin, calFromMs - 30 * 86400000));
	let chartEnd = $state(Math.min(rangeMax, calFromMs + 30 * 86400000));

	function autoResolution(s: number, e: number): 'raw' | 'hourly' | 'daily' {
		const days = (e - s) / 86400000;
		if (days <= 14) return 'raw';
		if (days <= 120) return 'hourly';
		return 'daily';
	}
	const chartResolution = $derived<'raw' | 'hourly' | 'daily'>(
		resolutionOverride === 'auto' ? autoResolution(chartStart, chartEnd) : resolutionOverride,
	);
	const gapThreshold = $derived(GAP_THRESHOLDS[chartResolution] ?? 0);

	function scheduleFetch() {
		if (fetchTimer) clearTimeout(fetchTimer);
		fetchTimer = setTimeout(() => { fetchTimer = null; void fetchSeries(); }, 50);
	}

	async function fetchSeries() {
		seriesLoading = true;
		const gen = ++fetchGeneration;
		try {
			const sr = await getSensorReadings(sensorId, {
				start: new Date(chartStart).toISOString(),
				end: new Date(chartEnd).toISOString(),
				resolution: chartResolution,
				include_raw: true,
			});
			if (gen !== fetchGeneration) return;
			series = sr;
		} catch (e) {
			if (gen === fetchGeneration) toastStore.error(e instanceof Error ? e.message : 'Failed to load readings');
		} finally {
			if (gen === fetchGeneration) seriesLoading = false;
		}
	}

	$effect(() => { if (sensorId) scheduleFetch(); });

	function onSliderChange(s: number, e: number) { chartStart = s; chartEnd = e; scheduleFetch(); }
	function onChartZoomSelect(startSec: number, endSec: number) {
		chartStart = startSec; chartEnd = endSec;
		sliderRef?.setRange(startSec, endSec);
		scheduleFetch();
	}
	function onChartResetZoom() {
		chartStart = rangeMin; chartEnd = rangeMax;
		sliderRef?.setRange(rangeMin, rangeMax);
		scheduleFetch();
	}

	// ─── Derived chart arrays ───
	const chartTimes = $derived(series?.times.map((t) => new Date(t).getTime() / 1000) ?? []);
	const chartRaw = $derived(series?.raw ?? []);
	const chartCalibrated = $derived(series?.calibrated ?? []);

	const windowFromSec = $derived(startMs / 1000);
	const windowUntilSec = $derived(isOpenEnded ? Infinity : endMs / 1000);

	const chartPreview = $derived.by(() => {
		const s = Number(slope), b = Number(intercept);
		if (!Number.isFinite(s) || !Number.isFinite(b)) return [];
		const from = windowFromSec, until = windowUntilSec;
		return chartTimes.map((t, i) => {
			const r = chartRaw[i];
			return r != null && t >= from && t < until ? s * r + b : null;
		});
	});

	const windowBand = $derived({ fromSec: windowFromSec, toSec: windowUntilSec === Infinity ? (chartTimes.length > 0 ? chartTimes[chartTimes.length - 1] + 3600 : windowFromSec + 1) : windowUntilSec });

	const scatterRaw = $derived.by(() => {
		const from = windowFromSec, until = windowUntilSec;
		return chartTimes.map((t, i) => t >= from && t < until ? chartRaw[i] : null);
	});
	const scatterPreview = $derived.by(() => {
		const from = windowFromSec, until = windowUntilSec;
		return chartTimes.map((t, i) => t >= from && t < until ? chartPreview[i] : null);
	});

	// Recompute neighbor calibration windows in real-time as the user drags, mirroring the
	// API's LEAD(valid_from) logic so the chart shows exactly what save will produce.
	const effectiveNeighborMarkers = $derived.by<CalibrationMarker[]>(() => {
		if (!allCalibrations.length) return [];
		const sorted = allCalibrations
			.map(c => ({ ...c, _fromMs: new Date(c.valid_from).getTime() }))
			.sort((a, b) => a._fromMs - b._fromMs);

		const currentId = calibration?.id ?? '__new__';
		const allEntries = [
			...sorted.filter(c => c.id !== currentId).map(c => ({ ms: c._fromMs, id: c.id })),
			{ ms: startMs, id: currentId },
		].sort((a, b) => a.ms - b.ms);

		const result: CalibrationMarker[] = [];
		for (let j = 0; j < allEntries.length; j++) {
			const entry = allEntries[j];
			if (entry.id === currentId) continue;
			const cal = sorted.find(c => c.id === entry.id)!;
			const nextFrom = j + 1 < allEntries.length ? allEntries[j + 1].ms : null;
			result.push({
				calibration_id: cal.id, sensor_id: cal.sensor_id,
				slope: cal.slope, intercept: cal.intercept,
				valid_from: new Date(entry.ms).toISOString(),
				valid_until: nextFrom != null ? new Date(nextFrom).toISOString() : null,
			});
		}
		return result;
	});

	const activeRange = $derived.by(() => {
		const rangeMs: Record<string, number> = { '24h': 86400000, '7d': 604800000, '30d': 2592000000, '90d': 7776000000 };
		const dur = chartEnd - chartStart;
		for (const [key, ms] of Object.entries(rangeMs)) if (Math.abs(dur - ms) < 60000) return key;
		return null;
	});

	function updateChartRange(range: string) {
		const rangeMs: Record<string, number> = { '24h': 86400000, '7d': 604800000, '30d': 2592000000, '90d': 7776000000 };
		chartEnd = rangeMax;
		chartStart = Math.max(rangeMin, chartEnd - rangeMs[range]);
		sliderRef?.setRange(chartStart, chartEnd);
		scheduleFetch();
	}

	function validateParams(): { s: number; b: number } | null {
		const s = Number(slope), b = Number(intercept);
		if (!Number.isFinite(s) || s === 0 || !Number.isFinite(b)) { toastStore.error('Slope must be non-zero, intercept numeric'); return null; }
		return { s, b };
	}

	async function save() {
		const p = validateParams();
		if (!p || !calibration) return;
		saving = true;
		try {
			await api.sensorCalibrations.update(calibration.id, {
				slope: p.s, intercept: p.b,
				valid_from: new Date(startMs).toISOString(),
				valid_until: isOpenEnded ? null : new Date(endMs).toISOString(),
			});
			await recalibrateCalibration(calibration.id);
			toastStore.success('Calibration updated - readings recomputed in the background');
			scheduleFetch();
			onchanged?.();
		} catch (e) { toastStore.error(e instanceof Error ? e.message : 'Update failed'); }
		finally { saving = false; }
	}

	async function create() {
		const p = validateParams();
		if (!p) return;
		saving = true;
		try {
			await api.sensorCalibrations.create({
				sensor_id: sensorId,
				valid_from: new Date(startMs).toISOString(),
				slope: p.s, intercept: p.b,
			});
			toastStore.success('Calibration added - readings will be recomputed in the background');
			onchanged?.();
		} catch (e) { toastStore.error(e instanceof Error ? e.message : 'Create failed'); }
		finally { saving = false; }
	}
</script>

<div class="space-y-3">
	<!-- Calibration parameters -->
	<div class="grid grid-cols-4 gap-3">
		<label class="flex flex-col gap-1 text-xs text-brand-muted">Slope<input type="number" step="any" bind:value={slope} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm" /></label>
		<label class="flex flex-col gap-1 text-xs text-brand-muted">Intercept<input type="number" step="any" bind:value={intercept} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm" /></label>
		<label class="flex flex-col gap-1 text-xs text-brand-muted">Valid from<input type="datetime-local" value={msToLocal(startMs)} oninput={(e) => startMs = localToMs(e.currentTarget.value)} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm" /></label>
		<label class="flex flex-col gap-1 text-xs text-brand-muted">Valid until {#if isOpenEnded}<span class="text-[10px] normal-case">(open / auto-managed)</span>{/if}<input type="datetime-local" value={msToLocal(endMs)} oninput={(e) => endMs = localToMs(e.currentTarget.value)} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm" /></label>
	</div>

	<!-- Stacked sliders: calibration window + view range -->
	{#if rangeMax > rangeMin}
		<div class="space-y-1">
			<div>
				<span class="text-[11px] font-semibold text-brand-muted">Calibration window</span>
				<TimeRangeSlider min={rangeMin} max={rangeMax} bind:start={startMs} bind:end={endMs} />
				<p class="text-[11px] text-brand-muted">Drag to set this calibration's window. The end boundary is auto-managed to the next calibration's start.</p>
			</div>
			<div>
				<span class="text-[11px] font-semibold text-brand-muted">View range</span>
				<TimeRangeSlider bind:this={sliderRef} min={rangeMin} max={rangeMax} bind:start={chartStart} bind:end={chartEnd} onchange={onSliderChange} />
			</div>
		</div>
	{/if}

	<!-- Chart controls -->
	<div class="flex items-center justify-between flex-wrap gap-2">
		<div class="flex gap-1">
			{#each ['24h', '7d', '30d', '90d'] as range}
				<button
					onclick={() => updateChartRange(range)}
					class="px-2 py-1 text-xs rounded cursor-pointer border-none {activeRange === range ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted hover:text-brand-text'}"
				>{range}</button>
			{/each}
		</div>
		<div class="flex gap-0.5">
			{#each [['auto', 'Auto'], ['raw', 'Raw'], ['hourly', 'Hourly'], ['daily', 'Daily']] as [val, label]}
				<button
					onclick={() => { resolutionOverride = val as typeof resolutionOverride; scheduleFetch(); }}
					class="px-2 py-1 text-xs rounded cursor-pointer border-none {resolutionOverride === val ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted hover:text-brand-text'}"
				>{label}{resolutionOverride === 'auto' && val === 'auto' ? ` (${chartResolution})` : ''}</button>
			{/each}
		</div>
	</div>

	<!-- Time-series chart: Raw + Calibrated (DB) + Preview (live formula within window) -->
	{#if seriesLoading && !series}
		<div class="rounded-md border border-brand-divider bg-brand-surface p-6 text-center text-sm text-brand-muted">Loading readings…</div>
	{:else if chartTimes.length > 0}
		<SensorSeriesChart
			times={chartTimes}
			raw={chartRaw}
			calibrated={chartCalibrated}
			preview={chartPreview}
			rawMin={series?.raw_min ?? []}
			rawMax={series?.raw_max ?? []}
			calMin={series?.calibrated_min ?? []}
			calMax={series?.calibrated_max ?? []}
			{units}
			deploymentBands={[]}
			calibrationMarkers={effectiveNeighborMarkers}
			showSensorVectors={false}
			showCalibrationMarkers={true}
			{gapThreshold}
			{windowBand}
			height={300}
			onZoomSelect={onChartZoomSelect}
			onResetZoom={onChartResetZoom}
			onCalibrationClick={onswitchcalibration ? (m) => onswitchcalibration!(m.calibration_id) : undefined}
		/>
		<ScatterPlot xData={scatterRaw} yData={scatterPreview} xLabel="Raw" yLabel="Preview" xUnits={units} yUnits={units} times={chartTimes} height={260} />
	{:else if series}
		<p class="text-xs text-brand-muted">No readings in this time range.</p>
	{/if}

	<div class="flex items-center justify-between">
		<span class="text-xs text-brand-muted">{seriesLoading ? 'Loading…' : series ? `${chartTimes.length} readings in view` : ''}</span>
		<Button variant="primary" onclick={mode === 'create' ? create : save} disabled={saving}>{saving ? (mode === 'create' ? 'Adding…' : 'Saving…') : (mode === 'create' ? 'Add calibration' : 'Save & recompute')}</Button>
	</div>
</div>
