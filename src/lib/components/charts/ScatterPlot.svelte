<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import uPlot from 'uplot';
	import 'uplot/dist/uPlot.min.css';
	import { tokens } from '$lib/charts/tokens';
	import { makeAxis, uPlotTheme } from '$lib/charts/uPlotTheme';
	import { linearRegression } from '$lib/charts/regression';

	let {
		xData,
		yData,
		xLabel,
		yLabel,
		xUnits,
		yUnits,
		times,
		height = 400,
		showRegression = true,
	}: {
		xData: (number | null)[];
		yData: (number | null)[];
		xLabel: string;
		yLabel: string;
		xUnits: string;
		yUnits: string;
		times?: number[];
		height?: number;
		showRegression?: boolean;
	} = $props();

	let el: HTMLDivElement;
	let chart: uPlot | null = null;

	/** Filter out paired points where either x or y is null, then sort by x ascending. */
	function preparePairs(): { xs: number[]; ys: number[]; timestamps: number[] } {
		const xs: number[] = [];
		const ys: number[] = [];
		const timestamps: number[] = [];
		const len = Math.min(xData.length, yData.length);
		for (let i = 0; i < len; i++) {
			const xv = xData[i];
			const yv = yData[i];
			if (xv != null && yv != null) {
				xs.push(xv);
				ys.push(yv);
				timestamps.push(times?.[i] ?? 0);
			}
		}
		// Sort by x ascending (uPlot requires sorted x-axis data)
		const indices = xs.map((_, i) => i);
		indices.sort((a, b) => xs[a] - xs[b]);
		return {
			xs: indices.map((i) => xs[i]),
			ys: indices.map((i) => ys[i]),
			timestamps: indices.map((i) => timestamps[i]),
		};
	}

	const regression = $derived.by(() => {
		const { xs, ys } = preparePairs();
		return linearRegression(xs, ys);
	});

	const pointCount = $derived(() => {
		const len = Math.min(xData.length, yData.length);
		let n = 0;
		for (let i = 0; i < len; i++) {
			if (xData[i] != null && yData[i] != null) n++;
		}
		return n;
	});

	function tooltipPlugin(tsArr: number[]): uPlot.Plugin {
		let tooltip: HTMLDivElement;
		return {
			hooks: {
				init: [
					(u: uPlot) => {
						tooltip = document.createElement('div');
						tooltip.style.cssText =
							`position:absolute;display:none;background:${uPlotTheme.tooltipBg};color:${uPlotTheme.tooltipColor};` +
							`padding:6px 10px;border-radius:${uPlotTheme.tooltipRadius}px;font-size:${uPlotTheme.tooltipFontSize};` +
							`pointer-events:none;z-index:100;white-space:nowrap;line-height:1.5;`;
						u.over.appendChild(tooltip);
					},
				],
				setCursor: [
					(u: uPlot) => {
						const idx = u.cursor.idx;
						if (idx == null || idx < 0 || u.data[0][idx] == null || u.data[1][idx] == null) {
							tooltip.style.display = 'none';
							return;
						}
						const xVal = u.data[0][idx];
						const yVal = u.data[1][idx];
						const ts = tsArr[idx];
						const timeLine = ts ? `<b>${new Date(ts * 1000).toLocaleString()}</b><br/>` : '';
						tooltip.innerHTML =
							`${timeLine}${xLabel}: ${xVal?.toFixed(3)} ${xUnits}<br/>${yLabel}: ${yVal?.toFixed(3)} ${yUnits}`;
						tooltip.style.display = 'block';
						const left = u.cursor.left ?? 0;
						const top = u.cursor.top ?? 0;
						const overRight = left + 220 > u.over.clientWidth;
						tooltip.style.left = (overRight ? left - 180 : left + 14) + 'px';
						tooltip.style.top = Math.max(0, top - 40) + 'px';
					},
				],
			},
		};
	}

	/** Custom paths callback: draws circles instead of connected lines. */
	function scatterPaths(u: uPlot, seriesIdx: number, idx0: number, idx1: number): uPlot.Series.Paths | null {
		const s = u.series[seriesIdx];
		const xScale = u.scales['x'];
		const yScale = u.scales[s.scale!];
		if (!xScale || !yScale) return null;

		const radius = 3;
		const fill = new Path2D();
		const stroke = new Path2D();

		for (let i = idx0; i <= idx1; i++) {
			const xv = u.data[0][i];
			const yv = u.data[seriesIdx][i];
			if (xv == null || yv == null) continue;
			const cx = u.valToPos(xv, 'x', true);
			const cy = u.valToPos(yv as number, s.scale!, true);
			fill.moveTo(cx + radius, cy);
			fill.arc(cx, cy, radius, 0, Math.PI * 2);
			stroke.moveTo(cx + radius + 0.5, cy);
			stroke.arc(cx, cy, radius + 0.5, 0, Math.PI * 2);
		}

		return { fill: () => fill, stroke: () => stroke, clip: undefined as unknown as Path2D };
	}

	function renderChart() {
		if (chart) { chart.destroy(); chart = null; }
		if (!el) return;
		const { xs, ys, timestamps } = preparePairs();
		if (xs.length === 0) return;

		const rect = el.getBoundingClientRect();
		if (rect.width === 0) return;

		const xAxisLabel = `${xLabel} (${xUnits})`;
		const yAxisLabel = `${yLabel} (${yUnits})`;

		const plotData: uPlot.AlignedData = [xs, ys];
		const seriesDefs: uPlot.Series[] = [
			{ label: xAxisLabel },
			{
				label: yAxisLabel,
				stroke: tokens.dataViz[0],
				fill: tokens.dataViz[0] + '80',
				width: 0,
				paths: scatterPaths,
				points: { show: false },
			},
		];

		const reg = regression;
		if (showRegression && reg) {
			const regY = xs.map((x) => reg.slope * x + reg.intercept);
			plotData.push(regY);
			seriesDefs.push({
				label: `Regression`,
				stroke: tokens.severity.alarm.border,
				width: 2,
				dash: [6, 3],
				points: { show: false },
			});
		}

		const opts: uPlot.Options = {
			width: rect.width,
			height,
			plugins: [tooltipPlugin(timestamps)],
			series: seriesDefs,
			scales: { x: { time: false } },
			axes: [
				{ ...makeAxis(), label: xAxisLabel, labelSize: 14, size: 40 },
				{ ...makeAxis(), label: yAxisLabel, labelSize: 14, size: 60 },
			],
			cursor: { drag: { x: true, y: true } },
			legend: { show: false },
		};

		chart = new uPlot(opts, plotData, el);
	}

	function handleResize() {
		if (!chart || !el) return;
		const w = el.getBoundingClientRect().width;
		if (w > 0) chart.setSize({ width: w, height });
	}

	$effect(() => {
		// Re-render when data or regression toggle change
		if (el && xData && yData) renderChart();
	});

	onMount(() => {
		window.addEventListener('resize', handleResize);
	});

	onDestroy(() => {
		window.removeEventListener('resize', handleResize);
		chart?.destroy();
	});
</script>

<div class="space-y-2">
	{#if regression && showRegression}
		<div class="flex items-center gap-4 px-3 py-2 rounded-md bg-brand-bg border border-brand-divider text-sm">
			<span class="font-mono text-xs">
				y = {regression.slope.toFixed(4)}x {regression.intercept >= 0 ? '+' : ''} {regression.intercept.toFixed(4)}
			</span>
			<span class="text-brand-muted">R² = <span class="font-semibold text-brand-text">{regression.rSquared.toFixed(4)}</span></span>
			<span class="text-brand-muted">n = {pointCount()}</span>
		</div>
	{:else if pointCount() > 0}
		<div class="px-3 py-2 rounded-md bg-brand-bg border border-brand-divider text-sm text-brand-muted">
			{pointCount()} points
		</div>
	{/if}

	{#if pointCount() === 0}
		<div class="h-[{height}px] flex items-center justify-center text-sm text-brand-muted rounded-md border border-brand-divider bg-brand-surface">
			No overlapping data points for the selected parameters
		</div>
	{:else}
		<div bind:this={el} class="w-full"></div>
	{/if}
</div>
