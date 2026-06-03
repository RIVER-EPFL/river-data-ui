<script lang="ts">
	import { api, type SensorCalibration } from '$api/crud';
	import { recalibrateCalibration } from '$api/service';
	import { getCalibrationWindow, type CalibrationWindowResponse } from '$api/sensors';
	import { toastStore } from '$lib/stores/toast.svelte';
	import ScatterPlot from '$components/charts/ScatterPlot.svelte';

	let { calibration, units = '', onchanged }: {
		calibration: SensorCalibration;
		units?: string;
		onchanged?: () => void;
	} = $props();

	let win = $state<CalibrationWindowResponse | null>(null);
	let loading = $state(false);
	let slope = $state(String(calibration.slope));
	let intercept = $state(String(calibration.intercept));
	let validFrom = $state(calibration.valid_from.slice(0, 16));
	let validUntil = $state(calibration.valid_until?.slice(0, 16) ?? '');
	let saving = $state(false);

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
				valid_from: new Date(validFrom).toISOString(),
				valid_until: validUntil ? new Date(validUntil).toISOString() : null,
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
		<label class="flex flex-col gap-1 text-xs text-brand-muted">Valid from<input type="datetime-local" bind:value={validFrom} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm" /></label>
		<label class="flex flex-col gap-1 text-xs text-brand-muted">Valid until<input type="datetime-local" bind:value={validUntil} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm" /></label>
	</div>
	<div class="flex items-center justify-between">
		<span class="text-xs text-brand-muted">{loading ? 'Loading…' : win ? `${win.point_count} readings in window` : ''}</span>
		<button onclick={save} disabled={saving} class="px-3 py-1 text-sm bg-brand-primary text-white rounded-md cursor-pointer border-none disabled:opacity-50">{saving ? 'Saving…' : 'Save & recompute'}</button>
	</div>
	{#if win && win.points.length > 0}
		<ScatterPlot xData={rawArr} yData={previewCal} xLabel="Raw" yLabel="Calibrated (preview)" xUnits={units} yUnits={units} {times} height={260} />
	{:else if win}
		<p class="text-xs text-brand-muted">No readings resolved by this window.</p>
	{/if}
</div>
