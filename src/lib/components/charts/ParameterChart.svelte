<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import uPlot from 'uplot';
	import 'uplot/dist/uPlot.min.css';
	import { PATCH } from '$api/client';
	import { uPlotTheme, makeSeries, makeAxis } from '$lib/charts/uPlotTheme';
	import { tokens } from '$lib/charts/tokens';
	import { getChartSyncGroup } from '$lib/charts/chart-sync.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import type { AlarmThreshold } from '$api/crud';

	export interface ChartData {
		times: number[];
		values: (number | null)[];
		mins?: (number | null)[] | null;
		maxs?: (number | null)[] | null;
	}

	let {
		siteId,
		siteParameterId,
		parameterId,
		parameterName,
		units = '',
		threshold,
		seriesIndex = 0,
		syncKey = '',
		chartData,
		loading: externalLoading = false,
		onZoomSelect,
		onResetZoom,
	}: {
		siteId: string;
		siteParameterId: string;
		parameterId: string;
		parameterName: string;
		units?: string;
		threshold?: AlarmThreshold | null;
		seriesIndex?: number;
		syncKey?: string;
		chartData?: ChartData | null;
		loading?: boolean;
		onZoomSelect?: (startMs: number, endMs: number) => void;
		onResetZoom?: () => void;
	} = $props();

	let el: HTMLDivElement;
	let chart: uPlot | null = null;

	const hasData = $derived(chartData != null && chartData.times.length > 0);
	const dataPoints = $derived(chartData?.times.length ?? 0);

	const syncGroup = syncKey ? getChartSyncGroup(syncKey) : null;
	const chartId = siteParameterId;

	function cursorSyncPlugin(): uPlot.Plugin {
		if (!syncGroup) return { hooks: {} };
		let hideRaf: number | null = null;
		return {
			hooks: {
				setCursor: [
					(u: uPlot) => {
						const idx = u.cursor.idx;
						if (idx != null && idx >= 0 && idx < (u.data[0]?.length ?? 0)) {
							if (hideRaf != null) { cancelAnimationFrame(hideRaf); hideRaf = null; }
							const bbox = u.root.getBoundingClientRect();
							const cx = (u.cursor.left ?? 0) + bbox.left;
							const cy = (u.cursor.top ?? 0) + bbox.top;
							syncGroup!.setCursor({ idx, mouseX: cx, mouseY: cy });
						} else {
							hideRaf = requestAnimationFrame(() => {
								syncGroup!.setCursor(null);
								hideRaf = null;
							});
						}
					},
				],
			},
		};
	}

	function thresholdBandPlugin(): uPlot.Plugin {
		if (!threshold) return { hooks: {} };
		return {
			hooks: {
				drawSeries: [
					(u: uPlot, si: number) => {
						if (si !== 1) return;
						const ctx = u.ctx;
						const { left, width, top, height } = u.bbox;
						const yPos = (val: number | null) => val == null ? null : u.valToPos(val, 'y', true);

						if (threshold!.warning_min != null || threshold!.warning_max != null) {
							const y0 = yPos(threshold!.warning_min) ?? (top + height);
							const y1 = yPos(threshold!.warning_max) ?? top;
							ctx.fillStyle = uPlotTheme.warningBandFill;
							ctx.fillRect(left, Math.min(y0, y1), width, Math.abs(y1 - y0));
						}
						if (threshold!.alarm_min != null || threshold!.alarm_max != null) {
							const y0 = yPos(threshold!.alarm_min) ?? (top + height);
							const y1 = yPos(threshold!.alarm_max) ?? top;
							ctx.fillStyle = uPlotTheme.alarmBandFill;
							ctx.fillRect(left, Math.min(y0, y1), width, Math.abs(y1 - y0));
						}
					},
				],
			},
		};
	}

	function renderChart() {
		if (chart) { chart.destroy(); chart = null; }
		if (!el || !chartData || chartData.times.length === 0) return;
		const rect = el.getBoundingClientRect();
		if (rect.width === 0) return;

		const { times, values, mins, maxs } = chartData;
		const toU = (arr: (number | null)[]): (number | undefined)[] => arr.map((v) => v ?? undefined);
		const hasMinMax = mins && maxs;

		const seriesDefs: uPlot.Series[] = [
			{},
			makeSeries(seriesIndex, parameterName, units),
		];
		const data: uPlot.AlignedData = [times, toU(values)] as any;

		if (hasMinMax) {
			seriesDefs.push(
				{ label: 'min', stroke: 'transparent', show: true, width: 0, points: { show: false } },
				{ label: 'max', stroke: 'transparent', show: true, width: 0, points: { show: false } },
			);
			(data as any[]).push(toU(mins!), toU(maxs!));
		}

		const opts: uPlot.Options = {
			width: rect.width,
			height: 220,
			plugins: [thresholdBandPlugin(), cursorSyncPlugin()],
			cursor: {
				show: true,
				drag: { x: true, y: false },
				...(syncKey ? { sync: { key: syncKey } } : {}),
			},
			legend: { show: false },
			scales: { x: { time: true }, y: {} },
			axes: [
				{ ...makeAxis(), size: 40 },
				{
					...makeAxis(),
					side: 1,
					label: units,
					labelSize: 12,
					labelFont: `500 11px ${tokens.font.body}`,
					size: 55,
				},
			],
			series: seriesDefs,
			bands: hasMinMax ? [{ series: [3, 2], fill: uPlotTheme.minMaxBandFill }] : undefined,
			hooks: {
				setSelect: [
					(u: uPlot) => {
						if (u.select.width > 0) {
							const left = u.posToVal(u.select.left, 'x');
							const right = u.posToVal(u.select.left + u.select.width, 'x');
							onZoomSelect?.(left * 1000, right * 1000);
							u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
						}
					},
				],
			},
		};

		chart = new uPlot(opts, data, el);

		if (onResetZoom) {
			chart.root.addEventListener('dblclick', () => onResetZoom!());
		}
	}

	function handleResize() {
		if (!chart || !el) return;
		const w = el.getBoundingClientRect().width;
		if (w > 0) chart.setSize({ width: w, height: 220 });
	}

	async function handleFlag(flag: boolean) {
		if (!chart) return;
		const sel = chart.select;
		if (!sel || sel.width === 0) { toastStore.info('Drag to select a time range first'); return; }
		const startTime = new Date(chart.posToVal(sel.left, 'x') * 1000).toISOString();
		const endTime = new Date(chart.posToVal(sel.left + sel.width, 'x') * 1000).toISOString();
		try {
			await PATCH(`/api/service/readings/${flag ? 'flag' : 'unflag'}`, {
				site_id: siteId, parameter_id: parameterId, start: startTime, end: endTime,
			});
			toastStore.success(flag ? 'Readings flagged' : 'Readings unflagged');
		} catch { toastStore.error('Failed to update flags'); }
	}

	$effect(() => {
		if (hasData) {
			syncGroup?.update(chartId, {
				times: chartData!.times,
				values: chartData!.values,
				threshold,
			});
			tick().then(() => renderChart());
		}
	});

	onMount(() => {
		syncGroup?.register({
			id: chartId,
			parameterName,
			units,
			paletteIndex: seriesIndex,
			times: [],
			values: [],
			threshold,
		});

		window.addEventListener('resize', handleResize);
		return () => {
			window.removeEventListener('resize', handleResize);
			chart?.destroy();
			syncGroup?.unregister(chartId);
		};
	});
</script>

<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
	<div class="flex items-center justify-between px-3 py-1.5 border-b border-brand-divider bg-brand-bg">
		<span class="text-sm font-semibold">
			{parameterName} <span class="text-brand-muted font-normal">({units})</span>
			{#if hasData}<span class="text-xs text-brand-muted font-normal ml-2">{dataPoints} pts</span>{/if}
		</span>
		<div class="flex items-center gap-1.5">
			<button onclick={() => handleFlag(true)} class="px-1.5 py-0.5 text-xs text-severity-alarm bg-transparent border border-severity-alarm-border rounded cursor-pointer hover:bg-severity-alarm-soft">Flag</button>
			<button onclick={() => handleFlag(false)} class="px-1.5 py-0.5 text-xs text-brand-muted bg-transparent border border-brand-divider rounded cursor-pointer hover:bg-brand-bg">Unflag</button>
		</div>
	</div>
	<div class="px-1 py-1">
		{#if externalLoading}
			<div class="h-[220px] flex items-center justify-center text-sm text-brand-muted">Loading...</div>
		{:else if !hasData}
			<div class="h-[220px] flex items-center justify-center text-sm text-brand-muted">No data for selected range</div>
		{:else}
			<div bind:this={el} class="w-full"></div>
		{/if}
	</div>
</div>
