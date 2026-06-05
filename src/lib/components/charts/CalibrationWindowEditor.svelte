<script lang="ts">
	import { api, type SensorCalibration } from '$api/crud';
	import { recalibrateCalibration } from '$api/service';
	import { getCalibrationWindow, type CalibrationWindowResponse } from '$api/sensors';
	import { toastStore } from '$lib/stores/toast.svelte';
	import ScatterPlot from '$components/charts/ScatterPlot.svelte';
	import SensorSeriesChart from '$components/charts/SensorSeriesChart.svelte';
	import TimeRangeSlider from '$components/charts/TimeRangeSlider.svelte';

	let { calibration, units = '', rangeMin, rangeMax, onchanged }: {
		calibration: SensorCalibration;
		units?: string;
		/** Sensor reading extent (ms) — slider bounds. */
		rangeMin: number;
		rangeMax: number;
		onchanged?: () => void;
	} = $props();

	let win = $state<CalibrationWindowResponse | null>(null);
	let loading = $state(false);
	let slope = $state(String(calibration.slope));
	let intercept = $state(String(calibration.intercept));
	let saving = $state(false);

	// Window as epoch-ms; the right handle at (or past) rangeMax means open-ended (valid_until = null).
	const initFrom = Math.min(Math.max(new Date(calibration.valid_from).getTime(), rangeMin), rangeMax);
	const initUntil = calibration.valid_until ? new Date(calibration.valid_until).getTime() : rangeMax;
	let startMs = $state(initFrom);
	let endMs = $state(Math.min(Math.max(initUntil, rangeMin), rangeMax));

	const OPEN_EPS = 60_000; // within 1 min of the far edge → treat as open-ended
	const isOpenEnded = $derived(endMs >= rangeMax - OPEN_EPS);

	const msToLocal = (ms: number) => new Date(ms).toISOString().slice(0, 16);
	const localToMs = (s: string) => new Date(s).getTime();

	async function loadWindow() {
		loading = true;
		try { win = await getCalibrationWindow(calibration.id); }
		catch (e) { toastStore.error(e instanceof Error ? e.message : 'Failed to load calibration window'); }
		finally { loading = false; }
	}
	$effect(() => { if (calibration.id) loadWindow(); });

	// Preview calibrated = slope*raw + intercept for the loaded points, live.
	const rawArr = $derived(win?.points.map((p) => p.raw_value) ?? []);
	const previewCal = $derived(win?.points.map((p) => Number(slope) * p.raw_value + Number(intercept)) ?? []);
	const times = $derived(win?.points.map((p) => new Date(p.time).getTime() / 1000) ?? []);

	async function save() {
		const s = Number(slope), b = Number(intercept);
		if (!Number.isFinite(s) || s === 0 || !Number.isFinite(b)) { toastStore.error('Slope must be non-zero, intercept numeric'); return; }
		saving = true;
		try {
			await api.sensorCalibrations.update(calibration.id, {
				slope: s, intercept: b,
				valid_from: new Date(startMs).toISOString(),
				valid_until: isOpenEnded ? null : new Date(endMs).toISOString(),
			});
			await recalibrateCalibration(calibration.id);
			toastStore.success('Calibration updated — readings recomputed in the background');
			await loadWindow();
			onchanged?.();
		} catch (e) { toastStore.error(e instanceof Error ? e.message : 'Update failed'); }
		finally { saving = false; }
	}
</script>

<div class="space-y-3">
	<div class="grid grid-cols-4 gap-3">
		<label class="flex flex-col gap-1 text-xs text-brand-muted">Slope<input type="number" step="any" bind:value={slope} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm" /></label>
		<label class="flex flex-col gap-1 text-xs text-brand-muted">Intercept<input type="number" step="any" bind:value={intercept} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm" /></label>
		<label class="flex flex-col gap-1 text-xs text-brand-muted">Valid from<input type="datetime-local" value={msToLocal(startMs)} oninput={(e) => startMs = localToMs(e.currentTarget.value)} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm" /></label>
		<label class="flex flex-col gap-1 text-xs text-brand-muted">Valid until {#if isOpenEnded}<span class="text-[10px] normal-case">(open / auto-managed)</span>{/if}<input type="datetime-local" value={msToLocal(endMs)} oninput={(e) => endMs = localToMs(e.currentTarget.value)} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm" /></label>
	</div>
	{#if rangeMax > rangeMin}
		<TimeRangeSlider min={rangeMin} max={rangeMax} bind:start={startMs} bind:end={endMs} />
		<p class="text-[11px] text-brand-muted">Drag to set this calibration's window. <code>valid_from</code> is authoritative; <code>valid_until</code> is normally re-derived from the next calibration's start when readings are reprocessed — drag the right handle to the far edge for open-ended.</p>
	{/if}
	<div class="flex items-center justify-between">
		<span class="text-xs text-brand-muted">{loading ? 'Loading…' : win ? `${win.point_count} readings in saved window` : ''}</span>
		<button onclick={save} disabled={saving} class="px-3 py-1 text-sm bg-brand-primary text-white rounded-md cursor-pointer border-none disabled:opacity-50">{saving ? 'Saving…' : 'Save & recompute'}</button>
	</div>
	{#if win && win.points.length > 0}
		<!-- What the calibration does to the actual data over time: raw vs the live preview. With an
		     identity (1/0) calibration the two lines coincide; changing slope/intercept diverges them. -->
		<SensorSeriesChart
			times={times}
			raw={rawArr}
			calibrated={previewCal}
			{units}
			deploymentBands={[]}
			calibrationMarkers={[]}
			showSensorVectors={false}
			showCalibrationMarkers={false}
			gapThreshold={0}
			height={240}
		/>
		<!-- Transfer view: raw → calibrated mapping (a straight line for any linear calibration). -->
		<ScatterPlot xData={rawArr} yData={previewCal} xLabel="Raw" yLabel="Calibrated (preview)" xUnits={units} yUnits={units} {times} height={260} />
	{:else if win}
		<p class="text-xs text-brand-muted">No readings resolved by this window.</p>
	{/if}
</div>
