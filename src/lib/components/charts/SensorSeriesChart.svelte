<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import uPlot from 'uplot';
	import 'uplot/dist/uPlot.min.css';
	import { makeSeries, makeAxis } from '$lib/charts/uPlotTheme';
	import {
		sensorVectorBandPlugin, calibrationMarkerPlugin, type OverlayVisibility,
	} from '$lib/charts/overlay-plugins';
	import type { SensorIdentityBand, CalibrationMarker } from '$api/sensors';

	let {
		times,            // seconds
		raw,
		calibrated,
		units = '',
		deploymentBands = [],
		calibrationMarkers = [],
		height = 320,
	}: {
		times: number[];
		raw: (number | null)[];
		calibrated: (number | null)[];
		units?: string;
		deploymentBands?: SensorIdentityBand[];
		calibrationMarkers?: CalibrationMarker[];
		height?: number;
	} = $props();

	let el: HTMLDivElement;
	let chart: uPlot | null = null;

	let vis = $state<OverlayVisibility>({ sensorVectors: true, calibrationMarkers: true });
	const visRef = { current: vis };
	$effect(() => { visRef.current = vis; chart?.redraw(); });

	const bandsRef = { current: deploymentBands };
	const markersRef = { current: calibrationMarkers };
	$effect(() => { bandsRef.current = deploymentBands; chart?.redraw(); });
	$effect(() => { markersRef.current = calibrationMarkers; chart?.redraw(); });

	function toU(arr: (number | null)[]) { return arr.map((v) => v ?? undefined); }

	function render() {
		if (chart) { chart.destroy(); chart = null; }
		if (!el || times.length === 0) return;
		const rect = el.getBoundingClientRect();
		if (rect.width === 0) return;
		const opts: uPlot.Options = {
			width: rect.width,
			height,
			tzDate: (ts) => uPlot.tzDate(new Date(ts * 1000), 'UTC'),
			plugins: [
				sensorVectorBandPlugin(bandsRef, visRef),
				calibrationMarkerPlugin(markersRef, visRef),
			],
			scales: { x: { time: true }, y: {} },
			legend: { show: true, live: false },
			cursor: { drag: { x: true, y: false, setScale: true } },
			series: [
				{},
				{ ...makeSeries(4, 'Raw', units), width: 1, dash: [3, 2] },
				{ ...makeSeries(0, 'Calibrated', units) },
			],
			axes: [
				{ ...makeAxis(), size: 40 },
				{ ...makeAxis(), side: 1, label: units, labelSize: 12, size: 55 },
			],
		};
		chart = new uPlot(opts, [times, toU(raw), toU(calibrated)] as uPlot.AlignedData, el);
		chart.root.addEventListener('dblclick', () => chart?.setScale('x', { min: times[0], max: times[times.length - 1] }));
	}

	function onResize() {
		if (chart && el) { const w = el.getBoundingClientRect().width; if (w > 0) chart.setSize({ width: w, height }); }
	}

	$effect(() => { if (times) tick().then(render); });
	onMount(() => window.addEventListener('resize', onResize));
	onDestroy(() => { window.removeEventListener('resize', onResize); chart?.destroy(); });
</script>

<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
	<div class="flex items-center justify-between px-3 py-1.5 border-b border-brand-divider bg-brand-bg">
		<span class="text-sm font-semibold">Raw vs Calibrated</span>
		<div class="flex items-center gap-3 text-xs">
			<label class="flex items-center gap-1 cursor-pointer text-brand-muted">
				<input type="checkbox" bind:checked={vis.sensorVectors} /> Site bands
			</label>
			<label class="flex items-center gap-1 cursor-pointer text-brand-muted">
				<input type="checkbox" bind:checked={vis.calibrationMarkers} /> Calibration markers
			</label>
		</div>
	</div>
	<div class="px-1 py-1 relative">
		<div bind:this={el} class="w-full" style="min-height:{height}px"></div>
		{#if times.length === 0}
			<div class="absolute inset-0 flex items-center justify-center text-sm text-brand-muted pointer-events-none">No readings for this sensor</div>
		{/if}
	</div>
</div>
