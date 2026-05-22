<script lang="ts">
	import { onMount, tick } from 'svelte';
	import uPlot from 'uplot';
	import 'uplot/dist/uPlot.min.css';
	import { uPlotTheme, makeSeries, makeAxis } from '$lib/charts/uPlotTheme';
	import { tokens } from '$lib/charts/tokens';
	import { getChartSyncGroup } from '$lib/charts/chart-sync.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { api, type AlarmThreshold, type Annotation } from '$api/crud';
	import AnnotateDialog from '$components/dialogs/AnnotateDialog.svelte';
	import FlagDialog from '$components/dialogs/FlagDialog.svelte';

	export interface ChartData {
		times: number[];
		values: (number | null)[];
		mins?: (number | null)[] | null;
		maxs?: (number | null)[] | null;
		flags?: (boolean | null)[] | null;
		flagReasons?: (string | null)[] | null;
	}

	let {
		siteId,
		siteParameterId,
		parameterId,
		parameterName,
		units = '',
		threshold,
		annotations = [],
		seriesIndex = 0,
		syncKey = '',
		chartData,
		loading: externalLoading = false,
		onZoomSelect,
		onResetZoom,
		onSaved,
	}: {
		siteId: string;
		siteParameterId: string;
		parameterId: string;
		parameterName: string;
		units?: string;
		threshold?: AlarmThreshold | null;
		annotations?: Annotation[];
		seriesIndex?: number;
		syncKey?: string;
		chartData?: ChartData | null;
		loading?: boolean;
		onZoomSelect?: (startMs: number, endMs: number) => void;
		onResetZoom?: () => void;
		onSaved?: () => void;
	} = $props();

	let el: HTMLDivElement;
	let chart: uPlot | null = null;

	type Mode = 'zoom' | 'annotate' | 'flag' | 'unflag';
	let selectionMode = $state<Mode>('zoom');
	let selectionModeRef = { current: 'zoom' as Mode };
	$effect(() => { selectionModeRef.current = selectionMode; });

	let dialogMode = $state<'annotate' | 'flag' | 'unflag'>('annotate');
	let annotateOpen = $state(false);
	let flagOpen = $state(false);
	let pendingRange = $state<{ startMs: number; endMs: number } | null>(null);

	let userExpansionPref = $state<boolean | null>(null);
	const annotationsExpanded = $derived(userExpansionPref ?? annotations.length <= 5);
	function toggleAnnotationsExpanded() {
		userExpansionPref = !annotationsExpanded;
	}

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

	const ANNOTATION_MIN_WIDTH = 6;
	const ANNOTATION_TICK_HEIGHT = 5;

	function annotationBandPlugin(anns: Annotation[]): uPlot.Plugin {
		if (anns.length === 0) return { hooks: {} };
		return {
			hooks: {
				draw: [
					(u: uPlot) => {
						const ctx = u.ctx;
						const { left, width, top, height } = u.bbox;
						const colors = uPlotTheme.annotationCategoryColors as Record<string, string>;
						ctx.save();
						ctx.beginPath();
						ctx.rect(left, top, width, height + ANNOTATION_TICK_HEIGHT + 2);
						ctx.clip();
						for (const a of anns) {
							const startSec = new Date(a.start_time).getTime() / 1000;
							const endSec = new Date(a.end_time).getTime() / 1000;
							const x0 = u.valToPos(startSec, 'x', true);
							const x1 = u.valToPos(endSec, 'x', true);
							const fill = colors[a.category] ?? colors.other;
							const rawWidth = Math.abs(x1 - x0);
							const drawWidth = Math.max(ANNOTATION_MIN_WIDTH, rawWidth);
							const mid = (Math.min(x0, x1) + Math.max(x0, x1)) / 2;
							const drawX = mid - drawWidth / 2;

							ctx.fillStyle = fill;
							ctx.fillRect(drawX, top, drawWidth, height);

							const tickColor = fill.replace(/rgba\(([^)]+),\s*[\d.]+\)/, 'rgba($1,0.9)');
							ctx.fillStyle = tickColor;
							ctx.beginPath();
							ctx.moveTo(x0, top + height);
							ctx.lineTo(x0 - 4, top + height + ANNOTATION_TICK_HEIGHT);
							ctx.lineTo(x0 + 4, top + height + ANNOTATION_TICK_HEIGHT);
							ctx.closePath();
							ctx.fill();
						}
						ctx.restore();
					},
				],
			},
		};
	}

	function flaggedPointPlugin(flags: (boolean | null)[] | null | undefined): uPlot.Plugin {
		if (!flags || !flags.some((f) => f === true)) return { hooks: {} };
		return {
			hooks: {
				draw: [
					(u: uPlot) => {
						const ctx = u.ctx;
						const times = u.data[0] as number[];
						const values = u.data[1] as (number | undefined)[];
						const size = uPlotTheme.flaggedSize;
						ctx.save();
						ctx.strokeStyle = uPlotTheme.flaggedColor;
						ctx.lineWidth = 1.5;
						for (let i = 0; i < flags.length; i++) {
							if (flags[i] !== true) continue;
							const v = values[i];
							if (v == null) continue;
							const x = u.valToPos(times[i], 'x', true);
							const y = u.valToPos(v, 'y', true);
							ctx.beginPath();
							ctx.moveTo(x - size, y - size);
							ctx.lineTo(x + size, y + size);
							ctx.moveTo(x + size, y - size);
							ctx.lineTo(x - size, y + size);
							ctx.stroke();
						}
						ctx.restore();
					},
				],
			},
		};
	}

	let dragOverlayEl: HTMLDivElement | null = null;

	function setupCustomSelection(u: uPlot) {
		const over = u.over;
		let dragStart: { x: number; t: number } | null = null;

		const onMouseDown = (e: MouseEvent) => {
			if (selectionModeRef.current === 'zoom') return;
			e.preventDefault();
			e.stopPropagation();
			const rect = over.getBoundingClientRect();
			const x = e.clientX - rect.left;
			dragStart = { x, t: u.posToVal(x, 'x') };
			if (dragOverlayEl) dragOverlayEl.remove();
			dragOverlayEl = document.createElement('div');
			dragOverlayEl.style.cssText = `position:absolute;top:0;bottom:0;left:${x}px;width:0;background:rgba(31,78,121,0.25);pointer-events:none;z-index:1`;
			over.appendChild(dragOverlayEl);
		};

		const onMouseMove = (e: MouseEvent) => {
			if (!dragStart || !dragOverlayEl) return;
			const rect = over.getBoundingClientRect();
			const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
			const left = Math.min(dragStart.x, x);
			const width = Math.abs(x - dragStart.x);
			dragOverlayEl.style.left = `${left}px`;
			dragOverlayEl.style.width = `${width}px`;
		};

		const finishDrag = (e: MouseEvent) => {
			if (!dragStart) return;
			e.preventDefault();
			e.stopPropagation();
			const rect = over.getBoundingClientRect();
			const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
			const t1 = u.posToVal(x, 'x');
			const startMs = Math.min(dragStart.t, t1) * 1000;
			const endMs = Math.max(dragStart.t, t1) * 1000;
			dragStart = null;
			if (dragOverlayEl) { dragOverlayEl.remove(); dragOverlayEl = null; }
			if (Math.abs(startMs - endMs) < 1000) return;
			handleSelection(startMs, endMs);
		};

		over.addEventListener('mousedown', onMouseDown, true);
		window.addEventListener('mousemove', onMouseMove, true);
		window.addEventListener('mouseup', finishDrag, true);

		return () => {
			over.removeEventListener('mousedown', onMouseDown, true);
			window.removeEventListener('mousemove', onMouseMove, true);
			window.removeEventListener('mouseup', finishDrag, true);
			if (dragOverlayEl) { dragOverlayEl.remove(); dragOverlayEl = null; }
		};
	}

	let teardownCustomSelection: (() => void) | null = null;

	function renderChart() {
		if (chart) { chart.destroy(); chart = null; }
		if (teardownCustomSelection) { teardownCustomSelection(); teardownCustomSelection = null; }
		if (!el || !chartData || chartData.times.length === 0) return;
		const rect = el.getBoundingClientRect();
		if (rect.width === 0) return;

		const { times, values, mins, maxs, flags } = chartData;
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
			plugins: [
				annotationBandPlugin(annotations),
				thresholdBandPlugin(),
				flaggedPointPlugin(flags),
				cursorSyncPlugin(),
			],
			cursor: {
				show: true,
				drag: { x: true, y: false, setScale: false },
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
						if (u.select.width <= 0) return;
						const inZoomMode = selectionModeRef.current === 'zoom';
						const leftSec = u.posToVal(u.select.left, 'x');
						const rightSec = u.posToVal(u.select.left + u.select.width, 'x');
						u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
						if (inZoomMode) {
							onZoomSelect?.(leftSec * 1000, rightSec * 1000);
						}
					},
				],
			},
		};

		chart = new uPlot(opts, data, el);
		teardownCustomSelection = setupCustomSelection(chart);

		if (onResetZoom) {
			chart.root.addEventListener('dblclick', () => onResetZoom!());
		}
	}

	function handleSelection(startMs: number, endMs: number) {
		if (selectionMode === 'zoom') {
			onZoomSelect?.(startMs, endMs);
			return;
		}
		pendingRange = { startMs, endMs };
		if (selectionMode === 'annotate') {
			dialogMode = 'annotate';
			annotateOpen = true;
		} else {
			dialogMode = selectionMode;
			flagOpen = true;
		}
		selectionMode = 'zoom';
	}

	function startSelection(mode: 'annotate' | 'flag' | 'unflag') {
		if (!hasData) {
			toastStore.info('No data to operate on');
			return;
		}
		selectionMode = mode;
	}

	function cancelSelection() {
		if (selectionMode !== 'zoom') selectionMode = 'zoom';
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && selectionMode !== 'zoom' && !annotateOpen && !flagOpen) {
			cancelSelection();
		}
	}

	function onDialogSuccess() {
		pendingRange = null;
		onSaved?.();
	}

	let confirmDeleteId = $state<string | null>(null);
	let deletingId = $state<string | null>(null);

	async function deleteAnnotation(id: string) {
		deletingId = id;
		confirmDeleteId = null;
		try {
			await api.annotations.remove(id);
			toastStore.success('Annotation deleted');
			onSaved?.();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to delete annotation');
		} finally {
			deletingId = null;
		}
	}

	function annotationRangeLabel(a: Annotation): string {
		const start = new Date(a.start_time);
		const end = new Date(a.end_time);
		const sameDay = start.toDateString() === end.toDateString();
		const fmt = (d: Date) => d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
		return sameDay ? `${fmt(start)} – ${end.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}` : `${fmt(start)} → ${fmt(end)}`;
	}

	function handleResize() {
		if (!chart || !el) return;
		const w = el.getBoundingClientRect().width;
		if (w > 0) chart.setSize({ width: w, height: 220 });
	}

	$effect(() => {
		if (hasData) {
			syncGroup?.update(chartId, {
				times: chartData!.times,
				values: chartData!.values,
				threshold,
				flags: chartData!.flags ?? null,
				flagReasons: chartData!.flagReasons ?? null,
				annotations,
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
			flags: null,
			flagReasons: null,
			annotations: [],
		});

		window.addEventListener('resize', handleResize);
		window.addEventListener('keydown', handleKeydown);
		return () => {
			window.removeEventListener('resize', handleResize);
			window.removeEventListener('keydown', handleKeydown);
			if (teardownCustomSelection) teardownCustomSelection();
			chart?.destroy();
			syncGroup?.unregister(chartId);
		};
	});

	const modeBanner = $derived.by(() => {
		if (selectionMode === 'annotate') return 'Drag on the chart to select a range to annotate. Esc to cancel.';
		if (selectionMode === 'flag') return 'Drag on the chart to select a range to flag. Esc to cancel.';
		if (selectionMode === 'unflag') return 'Drag on the chart to select a range to unflag. Esc to cancel.';
		return null;
	});
</script>

<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
	<div class="flex items-center justify-between px-3 py-1.5 border-b border-brand-divider bg-brand-bg">
		<span class="text-sm font-semibold">
			{parameterName} <span class="text-brand-muted font-normal">({units})</span>
			{#if hasData}<span class="text-xs text-brand-muted font-normal ml-2">{dataPoints} pts</span>{/if}
		</span>
		<div class="flex items-center gap-1.5">
			<button onclick={() => startSelection('annotate')} class="px-1.5 py-0.5 text-xs text-brand-primary bg-transparent border border-brand-primary/50 rounded cursor-pointer hover:bg-brand-primary/5" title="Annotate a time range">Annotate</button>
			<button onclick={() => startSelection('flag')} class="px-1.5 py-0.5 text-xs text-severity-alarm bg-transparent border border-severity-alarm-border rounded cursor-pointer hover:bg-severity-alarm-soft" title="Flag readings in a range">Flag</button>
			<button onclick={() => startSelection('unflag')} class="px-1.5 py-0.5 text-xs text-brand-muted bg-transparent border border-brand-divider rounded cursor-pointer hover:bg-brand-bg" title="Unflag readings in a range">Unflag</button>
		</div>
	</div>
	{#if modeBanner}
		<div class="px-3 py-1.5 text-xs bg-brand-primary/10 text-brand-primary border-b border-brand-primary/20 flex items-center justify-between">
			<span>{modeBanner}</span>
			<button onclick={cancelSelection} class="text-xs underline cursor-pointer bg-transparent border-none text-brand-primary">Cancel</button>
		</div>
	{/if}
	{#if annotations.length > 0}
		<div class="border-b border-brand-divider bg-brand-bg/40">
			<button
				onclick={toggleAnnotationsExpanded}
				class="w-full flex items-center justify-between px-3 py-1 text-xs text-brand-muted cursor-pointer bg-transparent border-none hover:bg-brand-bg hover:text-brand-text"
			>
				<span>{annotations.length} annotation{annotations.length === 1 ? '' : 's'} in view</span>
				<span class="flex items-center gap-1 text-brand-primary">
					{annotationsExpanded ? 'Hide' : 'Show'}
					<span class="font-mono text-[10px]">{annotationsExpanded ? '▾' : '▸'}</span>
				</span>
			</button>
			{#if annotationsExpanded}
				<div class="flex gap-1.5 flex-wrap px-3 pb-1.5 max-h-[64px] overflow-y-auto">
					{#each annotations as a (a.id)}
						{@const bg = (uPlotTheme.annotationCategoryColors as Record<string, string>)[a.category] ?? uPlotTheme.annotationCategoryColors.other}
						<div
							class="flex items-center gap-1 px-2 py-0.5 rounded text-xs border border-brand-divider"
							style="background:{bg}"
							title={`${a.category} · ${annotationRangeLabel(a)}`}
						>
							<span class="max-w-[200px] truncate text-brand-text">{a.text}</span>
							<span class="text-brand-muted font-mono text-[10px]">{annotationRangeLabel(a)}</span>
							{#if deletingId === a.id}
								<span class="text-brand-muted text-[10px]">deleting…</span>
							{:else if confirmDeleteId === a.id}
								<button
									onclick={() => deleteAnnotation(a.id)}
									class="text-severity-alarm hover:bg-severity-alarm hover:text-white cursor-pointer bg-transparent border border-severity-alarm/50 rounded px-1 leading-none text-[10px]"
									title="Confirm delete"
								>Delete?</button>
								<button
									onclick={() => confirmDeleteId = null}
									class="text-brand-muted hover:text-brand-text cursor-pointer bg-transparent border-none px-0.5 leading-none text-sm"
									title="Cancel"
								>✕</button>
							{:else}
								<button
									onclick={() => confirmDeleteId = a.id}
									class="text-brand-muted hover:text-severity-alarm cursor-pointer bg-transparent border-none px-0.5 leading-none text-sm"
									title="Delete annotation"
								>×</button>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
	<div class="px-1 py-1 relative {selectionMode !== 'zoom' ? 'cursor-crosshair' : ''}">
		<div bind:this={el} class="w-full" style="min-height:220px"></div>
		{#if !hasData && !externalLoading}
			<div class="absolute inset-0 flex items-center justify-center text-sm text-brand-muted pointer-events-none">No data for selected range</div>
		{/if}
		{#if externalLoading}
			<div class="absolute inset-0 flex items-center justify-center text-xs text-brand-muted bg-brand-surface/40 pointer-events-none">Loading…</div>
		{/if}
	</div>
</div>

{#if pendingRange}
	<AnnotateDialog
		bind:open={annotateOpen}
		{siteId}
		{parameterId}
		{parameterName}
		startMs={pendingRange.startMs}
		endMs={pendingRange.endMs}
		onsuccess={onDialogSuccess}
	/>
	<FlagDialog
		bind:open={flagOpen}
		mode={dialogMode === 'unflag' ? 'unflag' : 'flag'}
		{siteId}
		{parameterId}
		{parameterName}
		startMs={pendingRange.startMs}
		endMs={pendingRange.endMs}
		onsuccess={onDialogSuccess}
	/>
{/if}
