<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import uPlot from 'uplot';
	import 'uplot/dist/uPlot.min.css';
	import { makeSeries, makeAxis, makeGaps, uPlotTheme } from '$lib/charts/uPlotTheme';
	import {
		sensorVectorBandPlugin, calibrationMarkerPlugin, calibrationWindowBandPlugin,
		bandAtTime, calibrationAtTime,
		type OverlayVisibility, type CalibrationWindowBand,
	} from '$lib/charts/overlay-plugins';
	import type { SensorIdentityBand, CalibrationMarker } from '$api/sensors';

	let {
		times,            // seconds
		raw,
		calibrated,
		preview,
		rawMin = [],
		rawMax = [],
		calMin = [],
		calMax = [],
		units = '',
		deploymentBands = [],
		calibrationMarkers = [],
		showSensorVectors = true,
		showCalibrationMarkers = true,
		gapThreshold = 0,
		height = 320,
		windowBand,
		onZoomSelect,
		onResetZoom,
	}: {
		times: number[];
		raw: (number | null)[];
		calibrated: (number | null)[];
		preview?: (number | null)[];
		rawMin?: (number | null)[];
		rawMax?: (number | null)[];
		calMin?: (number | null)[];
		calMax?: (number | null)[];
		units?: string;
		deploymentBands?: SensorIdentityBand[];
		calibrationMarkers?: CalibrationMarker[];
		showSensorVectors?: boolean;
		showCalibrationMarkers?: boolean;
		gapThreshold?: number;
		height?: number;
		windowBand?: CalibrationWindowBand | null;
		onZoomSelect?: (startMs: number, endMs: number) => void;
		onResetZoom?: () => void;
	} = $props();

	let el: HTMLDivElement;
	let chart: uPlot | null = null;

	const visRef: { current: OverlayVisibility } = {
		current: { sensorVectors: showSensorVectors, calibrationMarkers: showCalibrationMarkers, alarmBands: false },
	};
	$effect(() => {
		visRef.current = { sensorVectors: showSensorVectors, calibrationMarkers: showCalibrationMarkers, alarmBands: false };
		chart?.redraw();
	});

	const bandsRef = { current: deploymentBands };
	const markersRef = { current: calibrationMarkers };
	const windowBandRef: { current: CalibrationWindowBand | null } = { current: windowBand ?? null };
	$effect(() => { bandsRef.current = deploymentBands; chart?.redraw(); });
	$effect(() => { markersRef.current = calibrationMarkers; chart?.redraw(); });
	$effect(() => { windowBandRef.current = windowBand ?? null; chart?.redraw(); });

	const hasBands = $derived(rawMin.length === times.length && rawMin.length > 0);
	const hasPreview = $derived(!!preview && preview.length === times.length);

	// Hover tooltip (self-contained — this chart isn't in a ChartSyncGroup).
	let hover = $state<{ idx: number; x: number; y: number } | null>(null);
	const fmtNum = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(2));
	const hoverInfo = $derived.by(() => {
		if (!hover || times[hover.idx] == null) return null;
		const tsSec = times[hover.idx];
		const band = showSensorVectors ? bandAtTime(bandsRef.current, tsSec) : null;
		const cal = showCalibrationMarkers ? calibrationAtTime(markersRef.current, tsSec) : null;
		return {
			time: new Date(tsSec * 1000).toLocaleString('en-US', {
				month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
				timeZone: 'UTC', timeZoneName: 'short',
			}),
			raw: fmtNum(raw[hover.idx]),
			calibrated: fmtNum(calibrated[hover.idx]),
			preview: hasPreview ? fmtNum(preview![hover.idx]) : null,
			band, cal,
		};
	});

	function tooltipPlugin(): uPlot.Plugin {
		return {
			hooks: {
				setCursor: [(u: uPlot) => {
					const idx = u.cursor.idx;
					const left = u.cursor.left ?? -1;
					if (idx == null || left < 0) { hover = null; return; }
					hover = { idx, x: left + u.over.offsetLeft, y: (u.cursor.top ?? 0) + u.over.offsetTop };
				}],
			},
		};
	}

	function toU(arr: (number | null)[]) { return arr.map((v) => v ?? undefined); }

	function render() {
		if (chart) { chart.destroy(); chart = null; }
		if (!el || times.length === 0) return;
		const rect = el.getBoundingClientRect();
		if (rect.width === 0) return;

		const gaps = gapThreshold > 0 ? makeGaps(gapThreshold) : undefined;
		const series: uPlot.Series[] = [
			{},
			{ ...makeSeries(4, 'Raw', units), width: 1, dash: [3, 2], ...(gaps ? { gaps } : {}) },
			{ ...makeSeries(0, 'Calibrated', units), ...(gaps ? { gaps } : {}) },
		];
		const data: uPlot.AlignedData = [times, toU(raw), toU(calibrated)] as uPlot.AlignedData;
		if (hasPreview) {
			series.push({ ...makeSeries(5, 'Preview', units), width: 2, dash: [6, 2], ...(gaps ? { gaps } : {}) });
			(data as unknown[]).push(toU(preview!));
		}
		let bands: uPlot.Band[] | undefined;
		if (hasBands) {
			const envStart = hasPreview ? 4 : 3;
			const hidden = (): uPlot.Series => ({ label: '', stroke: 'transparent', width: 0, points: { show: false }, ...(gaps ? { gaps } : {}), class: 'hidden-series' });
			series.push(hidden(), hidden(), hidden(), hidden());
			(data as unknown[]).push(toU(rawMin), toU(rawMax), toU(calMin), toU(calMax));
			bands = [
				{ series: [envStart + 1, envStart], fill: uPlotTheme.minMaxBandFill },
				{ series: [envStart + 3, envStart + 2], fill: uPlotTheme.minMaxBandFill },
			];
		}

		const opts: uPlot.Options = {
			width: rect.width,
			height,
			tzDate: (ts) => uPlot.tzDate(new Date(ts * 1000), 'UTC'),
			plugins: [
				sensorVectorBandPlugin(bandsRef, visRef),
				calibrationMarkerPlugin(markersRef, visRef),
				...(windowBand != null ? [calibrationWindowBandPlugin(windowBandRef)] : []),
				tooltipPlugin(),
			],
			scales: { x: { time: true }, y: {} },
			legend: { show: true, live: false },
			cursor: { show: true, drag: { x: true, y: false, setScale: false } },
			series,
			bands,
			axes: [
				{ ...makeAxis(), size: 40 },
				{ ...makeAxis(), side: 1, label: units, labelSize: 12, size: 55 },
			],
			hooks: {
				setSelect: [(u: uPlot) => {
					if (u.select.width <= 0) return;
					const leftSec = u.posToVal(u.select.left, 'x');
					const rightSec = u.posToVal(u.select.left + u.select.width, 'x');
					u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
					onZoomSelect?.(leftSec * 1000, rightSec * 1000);
				}],
			},
		};
		chart = new uPlot(opts, data, el);
		if (onResetZoom) chart.root.addEventListener('dblclick', () => onResetZoom());
	}

	// Re-render whenever the data changes (incl. the live calibration preview). Touch every array so
	// the effect tracks them, not just `times`.
	$effect(() => {
		void times; void raw; void calibrated; void preview; void rawMin; void rawMax; void calMin; void calMax; void windowBand;
		tick().then(render);
	});

	// A ResizeObserver renders/resizes when the container gets (or changes) a real width — covers
	// charts mounted in initially-zero-width containers (e.g. a just-expanded table row) where a
	// window-resize listener would never fire.
	let ro: ResizeObserver | null = null;
	onMount(() => {
		ro = new ResizeObserver(() => {
			const w = el?.getBoundingClientRect().width ?? 0;
			if (w === 0) return;
			if (chart) chart.setSize({ width: w, height });
			else render();
		});
		if (el) ro.observe(el);
	});
	onDestroy(() => { ro?.disconnect(); chart?.destroy(); });
</script>

<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
	<div class="flex items-center justify-between px-3 py-1.5 border-b border-brand-divider bg-brand-bg">
		<span class="text-sm font-semibold">Raw vs Calibrated</span>
	</div>
	<div class="px-1 py-1 relative">
		<div bind:this={el} class="w-full" style="min-height:{height}px"></div>
		{#if hoverInfo}
			<div
				class="absolute z-20 pointer-events-none"
				style="left:{hover!.x + 14}px; top:{hover!.y + 8}px; background:{uPlotTheme.tooltipBg}; padding:6px 10px; border-radius:{uPlotTheme.tooltipRadius}px; white-space:nowrap; min-width:170px"
			>
				<div style="font-size:11px;color:{uPlotTheme.tooltipColor};opacity:0.6;margin-bottom:4px">{hoverInfo.time}</div>
				<div class="flex items-center justify-between gap-4" style="font-size:12px;line-height:20px;color:{uPlotTheme.tooltipColor}">
					<span>Raw</span><span style="font-weight:600;font-variant-numeric:tabular-nums">{hoverInfo.raw} <span style="opacity:0.6;font-weight:400">{units}</span></span>
				</div>
				<div class="flex items-center justify-between gap-4" style="font-size:12px;line-height:20px;color:{uPlotTheme.tooltipColor}">
					<span>Calibrated</span><span style="font-weight:600;font-variant-numeric:tabular-nums">{hoverInfo.calibrated} <span style="opacity:0.6;font-weight:400">{units}</span></span>
				</div>
				{#if hoverInfo.preview != null}
					<div class="flex items-center justify-between gap-4" style="font-size:12px;line-height:20px;color:#E69F00">
						<span>Preview</span><span style="font-weight:600;font-variant-numeric:tabular-nums">{hoverInfo.preview} <span style="opacity:0.6;font-weight:400">{units}</span></span>
					</div>
				{/if}
				{#if hoverInfo.band || hoverInfo.cal}
					<div style="margin-top:5px;padding-top:5px;border-top:1px solid rgba(255,255,255,0.15)">
						{#if hoverInfo.band}
							<div style="font-size:11px;line-height:17px;color:{uPlotTheme.tooltipColor};opacity:0.9">
								Site: <span style="font-weight:600">{hoverInfo.band.site_name ?? '—'}</span>
							</div>
						{/if}
						{#if hoverInfo.cal}
							<div style="font-size:11px;line-height:17px;color:{uPlotTheme.tooltipColor};opacity:0.9">
								Calibration: y = {hoverInfo.cal.slope}x + {hoverInfo.cal.intercept}
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
		{#if times.length === 0}
			<div class="absolute inset-0 flex items-center justify-center text-sm text-brand-muted pointer-events-none">No readings for this sensor</div>
		{/if}
	</div>
</div>

<style>
	:global(.u-legend .hidden-series) { display: none; }
</style>
