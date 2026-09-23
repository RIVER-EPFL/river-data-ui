<script lang="ts">
	import { onMount, tick } from 'svelte';
	import uPlot from 'uplot';
	import 'uplot/dist/uPlot.min.css';
	import { uPlotTheme, makeSeries, makeAxis, makeGaps, tzDateOption, xRangeWithPadding } from '$lib/charts/uPlotTheme';
	import { timezoneStore } from '$lib/stores/timezone.svelte';
	import { tokens } from '$lib/charts/tokens';
	import { getChartSyncGroup } from '$lib/charts/chart-sync.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { api, type AlarmThreshold, type Annotation } from '$api/crud';
	import AnnotateDialog from '$components/dialogs/AnnotateDialog.svelte';
	import Button from '$components/ui/Button.svelte';
	import FlagDialog from '$components/dialogs/FlagDialog.svelte';
	import ReplicateFlagDialog from '$components/dialogs/ReplicateFlagDialog.svelte';
	import {
		sensorVectorBandPlugin, calibrationMarkerPlugin, bandAtTime, calibrationAtTime,
		BAND_STRIP_CSS, CALIBRATION_STRIP_CSS,
		alarmBandPlugin, computeSeverityBands, type AlarmSeverityBand,
		type OverlayVisibility,
	} from '$lib/charts/overlay-plugins';
	import type { SensorIdentityBand, CalibrationMarker } from '$api/sensors';
	import { spotMarkersPlugin, spotWhiskerExtent, type SpotPointStats } from '$lib/charts/spotMarkers';
	import { spotDispersion } from '$lib/charts/spotSummary';
	import type { ChartKeyPresence } from '$lib/charts/chartKey';
	import ChartKey from './ChartKey.svelte';
	import { cursorPoints, stepCursor, type CursorPoint } from '$lib/charts/keyboardCursor';
	import { continuousPointAt as continuousHit, type PointHit } from '$lib/charts/hitTest';
	import { formatMeasurement } from '$lib/format';
	import { spotMarkerColors, seriesColor } from '$lib/charts/legend';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { formatClockTime, formatDateTime, formatInstant } from '$lib/utils';

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
		parameterCode = '',
		units = '',
		decimals = null,
		threshold,
		annotations = [],
		seriesIndex = 0,
		syncKey = '',
		chartData,
		spotData = null,
		spotStats = null,
		showReplicates = false,
		withdrawnCount = 0,
		gapThreshold = 0,
		loading: externalLoading = false,
		onZoomSelect,
		onResetZoom,
		onSaved,
		sensorBands = [],
		calibrationMarkers = [],
		showSensorVectors = false,
		showCalibrationMarkers = false,
		showAlarmBands = true,
		isDerived = false,
		externalSource = null,
		activeBreach = null,
		nowMs = 0,
		originLabel = '',
		extraSeries = [],
		primarySeriesLabel = null,
		emptyMessage = 'No data for selected range',
		exactTimes = true,
		onpointclick,
	}: {
		siteId: string;
		siteParameterId: string;
		parameterId: string;
		parameterName: string;
		parameterCode?: string;
		units?: string;
		/** `site_parameters.decimal_places` for the slot; null falls back to significant digits. */
		decimals?: number | null;
		threshold?: AlarmThreshold | null;
		annotations?: Annotation[];
		seriesIndex?: number;
		syncKey?: string;
		chartData?: ChartData | null;
		/** Discrete spot/grab samples (measurement_type='spot'), drawn as unconnected diamond
		 *  markers. When present without chartData, only the markers render (no continuous line). */
		spotData?: ChartData | null;
		/** Replicate mean±sd whisker stats for spot points, keyed by epoch ms. */
		spotStats?: Map<number, SpotPointStats> | null;
		/** Plot each stored replicate as its own dot beside the group's mean. */
		showReplicates?: boolean;
		/** Spot instants in the window the source has taken back in full, served or not. */
		withdrawnCount?: number;
		/** Whether `chartData.times` are the stored instants rather than aggregate bucket starts.
		 *  A bucket start resolves no reading, so the continuous click affordance is withdrawn. */
		exactTimes?: boolean;
		gapThreshold?: number;
		loading?: boolean;
		/** Shown in place of the plot when there is nothing to draw. */
		emptyMessage?: string;
		onZoomSelect?: (startMs: number, endMs: number) => void;
		onResetZoom?: () => void;
		onSaved?: () => void;
		sensorBands?: SensorIdentityBand[];
		calibrationMarkers?: CalibrationMarker[];
		showSensorVectors?: boolean;
		showCalibrationMarkers?: boolean;
		showAlarmBands?: boolean;
		isDerived?: boolean;
		/** The outside feed the values come from, attributed in the header where the site
		 *  subscribes to one for this parameter. */
		externalSource?: { system: string; station: string; attribution: string } | null;
		/** Live active breach for this parameter (from getActiveAlarms), shown as a header badge. */
		activeBreach?: { severity: number; started_at?: string | null; since: string } | null;
		/** Ticking clock (ms) from the parent so the badge's "active for …" stays fresh. */
		nowMs?: number;
		/** One-line ingestion origin for the series, shown in the shared tooltip. */
		originLabel?: string;
		/** Further lines sharing this chart's x values, one per instrument when the slot is split
		 *  by sensor. Drawn after the primary series, each in its own palette colour. */
		extraSeries?: Array<{ label: string; values: (number | null)[] }>;
		/** What to call the primary line when it is one instrument's rather than the slot's. */
		primarySeriesLabel?: string | null;
		/** Pin a point's provenance record: called on click for continuous points and (instead of
		 *  the replicate dialog) for spot points. */
		onpointclick?: (p: {
			timeMs: number;
			measurementType: 'continuous' | 'spot';
			sampleId?: string | null;
		}) => void;
	} = $props();

	function breachDuration(fromIso: string): string {
		const m = Math.floor(((nowMs || Date.now()) - new Date(fromIso).getTime()) / 60000);
		if (m < 1) return 'less than a minute';
		if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h}h ${m % 60}m`;
		const d = Math.floor(h / 24);
		return `${d}d ${h % 24}h`;
	}

	let el: HTMLDivElement;
	let chart: uPlot | null = null;

	let yZoomed = $state(false);

	type Mode = 'zoom' | 'annotate' | 'flag' | 'unflag';
	let selectionMode = $state<Mode>('zoom');
	let selectionModeRef = { current: 'zoom' as Mode };
	$effect(() => { selectionModeRef.current = selectionMode; });

	// Optional overlay layers - DEFAULT OFF. visRef/bandsRef/markersRef are read live inside
	// the draw-hook closures, so toggling visibility only needs chart.redraw() (no rebuild).
	const overlayVisRef: { current: OverlayVisibility } = {
		current: { sensorVectors: showSensorVectors, calibrationMarkers: showCalibrationMarkers, alarmBands: showAlarmBands },
	};
	$effect(() => {
		overlayVisRef.current = { sensorVectors: showSensorVectors, calibrationMarkers: showCalibrationMarkers, alarmBands: showAlarmBands };
		chart?.redraw();
	});
	const sensorBandsRef: { current: SensorIdentityBand[] } = { current: sensorBands };
	const calMarkersRef: { current: CalibrationMarker[] } = { current: calibrationMarkers };
	$effect(() => { sensorBandsRef.current = sensorBands; chart?.redraw(); });
	$effect(() => { calMarkersRef.current = calibrationMarkers; chart?.redraw(); });

	// Warning/alarm severity bands derived from the plotted values + threshold (same logic as the
	// tooltip badge). Read live in the draw hook, so recompute + redraw on data/threshold change.
	const alarmBandsRef: { current: AlarmSeverityBand[] } = { current: [] };
	const alarmSeverityBands = $derived(
		computeSeverityBands(chartData?.times ?? [], chartData?.values ?? [], threshold),
	);
	$effect(() => { alarmBandsRef.current = alarmSeverityBands; chart?.redraw(); });

	let dialogMode = $state<'annotate' | 'flag' | 'unflag'>('annotate');
	let annotateOpen = $state(false);
	let flagOpen = $state(false);
	let replicateOpen = $state(false);
	let replicateTarget = $state<{ timeMs: number; stats: SpotPointStats } | null>(null);
	let pendingRange = $state<{ startMs: number; endMs: number } | null>(null);

	let userExpansionPref = $state<boolean | null>(null);
	const annotationsExpanded = $derived(userExpansionPref ?? annotations.length <= 5);
	function toggleAnnotationsExpanded() {
		userExpansionPref = !annotationsExpanded;
	}

	const hasContinuous = $derived(chartData != null && chartData.times.length > 0);
	const hasSpot = $derived(spotData != null && spotData.times.length > 0);
	const hasData = $derived(hasContinuous || hasSpot);

	// The key names only what this render drew, so a mark absent from the plot is absent from it.
	const keyPresence = $derived.by<ChartKeyPresence>(() => {
		const stats = [...(spotStats?.values() ?? [])];
		const dispersions = new Set(stats.map((s) => spotDispersion(s)));
		const categories = [...new Set((annotations ?? []).map((a) => a.category))];
		return {
			line: hasContinuous,
			minMaxBand: !!chartData?.mins && !!chartData?.maxs,
			spot: hasSpot,
			spotAgreed: dispersions.has('agreed'),
			spotSingle: hasSpot && dispersions.has('single'),
			sdBar: dispersions.has('spread'),
			replicateDots: showReplicates && stats.some((s) => (s.replicates?.length ?? 0) > 1),
			flagged: (chartData?.flags ?? []).some((f) => f === true) || (publishedSpotFlags()?.size ?? 0) > 0,
			withdrawn: stats.some((s) => s.withdrawn === true),
			sensorBands: showSensorVectors && sensorBands.length > 0,
			calibrationMarkers: showCalibrationMarkers && calibrationMarkers.length > 0,
			alarmBands: showAlarmBands && alarmSeverityBands.length > 0,
			annotationCategories: categories,
			units,
		};
	});
	const dataPoints = $derived((chartData?.times.length ?? 0) + (spotData?.times.length ?? 0));

	// The keyboard route to a point: arrows walk the plotted points with the crosshair following,
	// Enter opens what a click would. Reset whenever the plotted set changes.
	const keyPoints = $derived(cursorPoints(chartData ?? null, spotData ?? null, spotStats ?? null, exactTimes));
	let cursorIndex = $state<number | null>(null);
	$effect(() => {
		void keyPoints;
		cursorIndex = null;
	});

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
							syncGroup!.setCursor({ idx, mouseX: cx, mouseY: cy, sourceId: chartId });
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

	// Thin dashed reference lines at each threshold limit, so the breach levels are visible without
	// shading the whole plot (the time-period severity bands convey when the value actually breached).
	function thresholdLinePlugin(): uPlot.Plugin {
		if (!threshold) return { hooks: {} };
		return {
			hooks: {
				drawSeries: [
					(u: uPlot, si: number) => {
						if (si !== 1) return;
						if (!overlayVisRef.current.alarmBands) return; // dashed limit lines follow the Alarm bands toggle
						const ctx = u.ctx;
						const { left, width, top, height } = u.bbox;
						const limitLine = (val: number | null | undefined, color: string) => {
							if (val == null) return;
							const y = u.valToPos(val, 'y', true);
							if (y < top || y > top + height) return; // off-scale → skip
							ctx.save();
							ctx.strokeStyle = color;
							ctx.lineWidth = 1;
							ctx.setLineDash([5, 4]);
							ctx.beginPath();
							ctx.moveTo(left, y);
							ctx.lineTo(left + width, y);
							ctx.stroke();
							ctx.restore();
						};
						limitLine(threshold!.warning_min, uPlotTheme.warningBandStroke);
						limitLine(threshold!.warning_max, uPlotTheme.warningBandStroke);
						limitLine(threshold!.alarm_min, uPlotTheme.alarmBandStroke);
						limitLine(threshold!.alarm_max, uPlotTheme.alarmBandStroke);
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

	// Spot/grab diamonds (and mean±sd whiskers when replicate stats are provided) are painted by
	// the shared spotMarkers module; the plugin reads the transparent spot series' data.
	/// The y range, widened so an error bar is never clipped at the plot edge. uPlot ranges from the
	/// series values, which are the means, so a whisker wider than the spread of the means would
	/// otherwise render as a full-height line with both caps off-screen and no indication it was
	/// cut. The default padding is kept for the case where nothing carries a whisker.
	const Y_RANGE_BUFFER = 0.05;

	/// The spot arm's flags keyed by instant, for the tooltip. The published `flags` channel is the
	/// continuous arm's whenever a continuous arm exists, so without this a flagged grab on a mixed
	/// chart is reported as unflagged.
	function publishedSpotFlags(): Map<number, boolean> | null {
		const f = spotData?.flags;
		if (!f || !spotData) return null;
		const out = new Map<number, boolean>();
		for (let i = 0; i < spotData.times.length; i++) {
			if (f[i] === true) out.set(spotData.times[i], true);
		}
		return out.size > 0 ? out : null;
	}

	function yRange(u: uPlot, dataMin: number | null, dataMax: number | null): [number, number] {
		const fallback = uPlot.rangeNum(dataMin ?? 0, dataMax ?? 1, 0.1, true) as [number, number];
		const extent = spotWhiskerExtent(spotStats?.values(), showReplicates);
		if (!extent) return fallback;
		let lo = Math.min(fallback[0], extent[0]);
		let hi = Math.max(fallback[1], extent[1]);
		const span = hi - lo;
		const pad = span > 0 ? span * Y_RANGE_BUFFER : Math.abs(hi) * Y_RANGE_BUFFER || 1;
		lo -= pad;
		hi += pad;
		return [lo, hi];
	}

	function spotDiamondPlugin(
		seriesIdx: number,
		flagged: (boolean | null)[] | null,
	): uPlot.Plugin {
		if (seriesIdx < 0) return { hooks: {} };
		const stats = spotStats
			? new Map([...spotStats.entries()].map(([ms, s]) => [ms / 1000, s]))
			: undefined;
		return spotMarkersPlugin(() => [
			{
				seriesIdx,
				...spotMarkerColors(seriesIndex),
				stats,
				showReplicates,
				flagged: flagged ? (i: number) => flagged[i] === true : undefined,
			},
		]);
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
		const cont = chartData && chartData.times.length > 0 ? chartData : null;
		const spot = spotData && spotData.times.length > 0 ? spotData : null;
		if (!el || (!cont && !spot)) return;
		const rect = el.getBoundingClientRect();
		if (rect.width === 0) return;

		const toU = (arr: (number | null)[]): (number | undefined)[] => arr.map((v) => v ?? undefined);
		const hasMinMax = !!cont && !!cont.mins && !!cont.maxs;

		const gaps = gapThreshold > 0 ? makeGaps(gapThreshold) : undefined;

		// x-axis + aligned value columns. When both a continuous line and spot markers are
		// present they get overlaid onto one shared (union) timeline so uPlot can render both.
		let times: number[];
		let contValues: (number | undefined)[] = [];
		let contMins: (number | undefined)[] | null = null;
		let contMaxs: (number | undefined)[] | null = null;
		let flags: (boolean | null)[] | null = null;
		let spotFlags: (boolean | null)[] | null = null;
		let spotValues: (number | undefined)[] = [];

		if (cont && spot) {
			const idx = new Map<number, number>();
			const union: number[] = [];
			for (const t of cont.times) if (!idx.has(t)) { idx.set(t, union.length); union.push(t); }
			for (const t of spot.times) if (!idx.has(t)) { idx.set(t, union.length); union.push(t); }
			union.sort((a, b) => a - b);
			union.forEach((t, i) => idx.set(t, i));
			times = union;
			const alignNum = (ts: number[], vs: (number | null)[]): (number | undefined)[] => {
				const out = new Array<number | undefined>(union.length).fill(undefined);
				for (let i = 0; i < ts.length; i++) { const j = idx.get(ts[i]); if (j != null) out[j] = vs[i] ?? undefined; }
				return out;
			};
			contValues = alignNum(cont.times, cont.values);
			if (hasMinMax) { contMins = alignNum(cont.times, cont.mins!); contMaxs = alignNum(cont.times, cont.maxs!); }
			if (cont.flags) {
				const fout = new Array<boolean | null>(union.length).fill(null);
				for (let i = 0; i < cont.times.length; i++) { const j = idx.get(cont.times[i]); if (j != null) fout[j] = cont.flags[i] ?? null; }
				flags = fout;
			}
			spotValues = alignNum(spot.times, spot.values);
			if (spot.flags) {
				const fout = new Array<boolean | null>(union.length).fill(null);
				for (let i = 0; i < spot.times.length; i++) { const j = idx.get(spot.times[i]); if (j != null) fout[j] = spot.flags[i] ?? null; }
				spotFlags = fout;
			}
		} else if (cont) {
			times = cont.times;
			contValues = toU(cont.values);
			if (hasMinMax) { contMins = toU(cont.mins!); contMaxs = toU(cont.maxs!); }
			flags = cont.flags ?? null;
		} else {
			times = spot!.times;
			spotValues = toU(spot!.values);
			// With no continuous arm the flagged-point plugin reads the spot series itself, so its
			// flags travel as `flags`; a marker is never drawn twice.
			flags = spot!.flags ?? null;
		}

		// Series layout: index 1 is the continuous line (or, when there is no line, the spot
		// markers themselves so the y-scale still ranges). thresholdLinePlugin/flaggedPointPlugin
		// read series 1, and the min/max band references series [3, 2], keep spot after those.
		const seriesDefs: uPlot.Series[] = [{}];
		const data: uPlot.AlignedData = [times] as any;
		let spotSeriesIdx = -1;

		if (cont) {
			seriesDefs.push({
				...makeSeries(seriesIndex, primarySeriesLabel ?? parameterName, units, decimals),
				gaps,
			});
			(data as any[]).push(contValues);
			if (hasMinMax) {
				seriesDefs.push(
					{ label: 'min', stroke: 'transparent', show: true, width: 0, points: { show: false }, gaps },
					{ label: 'max', stroke: 'transparent', show: true, width: 0, points: { show: false }, gaps },
				);
				(data as any[]).push(contMins!, contMaxs!);
			}
			if (spot) {
				spotSeriesIdx = (data as any[]).length;
				seriesDefs.push({ label: parameterName, stroke: 'transparent', width: 0, points: { show: false } });
				(data as any[]).push(spotValues);
			}
		} else {
			spotSeriesIdx = 1;
			seriesDefs.push({ label: parameterName, stroke: 'transparent', width: 0, points: { show: false } });
			(data as any[]).push(spotValues);
		}

		// Extra lines come last: the plugins address series 1 and the min/max band references
		// [3, 2], so anything appended here cannot disturb them.
		for (const [i, extra] of extraSeries.entries()) {
			seriesDefs.push({
				...makeSeries(seriesIndex + i + 1, extra.label, units, decimals),
				gaps,
			});
			(data as any[]).push(extra.values.map((v) => (v == null ? null : v)));
		}

		const stripPad = (showSensorVectors ? BAND_STRIP_CSS : 0) + (showCalibrationMarkers ? CALIBRATION_STRIP_CSS : 0);

		const opts: uPlot.Options = {
			width: rect.width,
			height: 220,
			padding: [stripPad, 0, 0, 0],
			...tzDateOption(),
			plugins: [
				alarmBandPlugin(alarmBandsRef, overlayVisRef),
				sensorVectorBandPlugin(sensorBandsRef, overlayVisRef),
				annotationBandPlugin(annotations),
				thresholdLinePlugin(),
				calibrationMarkerPlugin(calMarkersRef, overlayVisRef),
				flaggedPointPlugin(flags),
				spotDiamondPlugin(spotSeriesIdx, spotFlags),
				cursorSyncPlugin(),
			],
			cursor: {
				show: true,
				drag: { x: true, y: true, setScale: false },
				...(syncKey ? { sync: { key: syncKey } } : {}),
			},
			legend: { show: false },
			scales: { x: { time: true, range: xRangeWithPadding }, y: { range: yRange } },
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
						const selHeight = u.select.height;
						const topVal = u.posToVal(u.select.top, 'y');
						const botVal = u.posToVal(u.select.top + selHeight, 'y');
						u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
						if (inZoomMode) {
							onZoomSelect?.(leftSec * 1000, rightSec * 1000);
							if (selHeight > 10 && topVal !== botVal) {
								u.setScale('y', { min: Math.min(topVal, botVal), max: Math.max(topVal, botVal) });
								yZoomed = true;
							}
						}
					},
				],
			},
		};

		chart = new uPlot(opts, data, el);
		const teardownSelect = setupCustomSelection(chart);
		const teardownClick = setupConfigClick(chart);
		teardownCustomSelection = () => { teardownSelect(); teardownClick(); };

		if (onResetZoom) {
			chart.root.addEventListener('dblclick', () => {
				onResetZoom!();
				if (yZoomed && chart) {
					chart.setScale('y', { min: undefined as any, max: undefined as any });
					yZoomed = false;
				}
			});
		}
	}

	/// The spot point under the click, if one is within a few pixels and carries replicates.
	/// Clicking a grab marker is the only route to per-replicate flagging: a hover tooltip
	/// cannot host an action.
	const SPOT_CLICK_TOLERANCE_PX = 8;

	function spotPointAt(
		u: uPlot,
		xCss: number,
		yCss: number,
	): { timeMs: number; stats: SpotPointStats; distance: number } | null {
		const stats = spotStats;
		if (!stats || stats.size === 0) return null;
		// Without an inspector wired, only replicate-carrying points are actionable (the dialog
		// is a flagging surface); with one, every spot point has a record to show.
		const requireReplicates = !onpointclick;
		let best: { timeMs: number; stats: SpotPointStats; distance: number } | null = null;
		for (const [timeMs, stat] of stats) {
			if (requireReplicates && (!stat.replicates || stat.replicates.length === 0)) continue;
			const dx = Math.abs(u.valToPos(timeMs / 1000, 'x') - xCss);
			if (dx > SPOT_CLICK_TOLERANCE_PX) continue;
			const dy = Math.abs(u.valToPos(stat.mean, 'y') - yCss);
			if (dy > SPOT_CLICK_TOLERANCE_PX) continue;
			const distance = Math.hypot(dx, dy);
			if (!best || distance < best.distance) best = { timeMs, stats: stat, distance };
		}
		return best;
	}

	/// The continuous data point under the click: nearest in x, and vertically close to the line.
	const CONTINUOUS_CLICK_TOLERANCE_PX = 12;
	const CONTINUOUS_TOLERANCE = { x: SPOT_CLICK_TOLERANCE_PX, y: CONTINUOUS_CLICK_TOLERANCE_PX };

	function continuousPointAt(u: uPlot, xCss: number, yCss: number): PointHit | null {
		// An aggregate bucket start is not an instant any reading sits at, so there is nothing to
		// resolve and the affordance is withdrawn rather than offered and answered with a 404.
		if (!exactTimes) return null;
		if (!onpointclick || !chartData) return null;
		return continuousHit(
			u,
			xCss,
			yCss,
			chartData.times,
			chartData.values,
			CONTINUOUS_TOLERANCE,
		);
	}

	function bandStripAt(u: uPlot, xCss: number, yCss: number): SensorIdentityBand | null {
		if (!overlayVisRef.current.sensorVectors) return null;
		if (yCss < 0 || yCss > BAND_STRIP_CSS) return null;
		return bandAtTime(sensorBandsRef.current, u.posToVal(xCss, 'x'));
	}

	function calStripAt(u: uPlot, xCss: number, yCss: number): { sensorId: string; calId: string } | null {
		if (!overlayVisRef.current.calibrationMarkers) return null;
		if (yCss < BAND_STRIP_CSS || yCss > BAND_STRIP_CSS + CALIBRATION_STRIP_CSS) return null;
		const m = calibrationAtTime(calMarkersRef.current, u.posToVal(xCss, 'x'));
		if (!m) return null;
		return { sensorId: m.sensor_id, calId: m.calibration_id };
	}

	function setupConfigClick(u: uPlot): () => void {
		const over = u.over;
		let downX: number | null = null;
		const onDown = (e: MouseEvent) => { downX = e.clientX; };
		const onMove = (e: MouseEvent) => {
			const rect = over.getBoundingClientRect();
			const xCss = e.clientX - rect.left;
			const yCss = e.clientY - rect.top;
			const actionable =
				bandStripAt(u, xCss, yCss) ||
				calStripAt(u, xCss, yCss) ||
				spotPointAt(u, xCss, yCss) ||
				continuousPointAt(u, xCss, yCss);
			over.style.cursor = actionable ? 'pointer' : '';
		};
		const onUp = (e: MouseEvent) => {
			const start = downX;
			downX = null;
			if (start == null || Math.abs(e.clientX - start) > 4) return;
			if (selectionModeRef.current !== 'zoom') return;
			const rect = over.getBoundingClientRect();
			const xCss = e.clientX - rect.left;
			const yCss = e.clientY - rect.top;
			const band = bandStripAt(u, xCss, yCss);
			if (band) { goto(`${base}/sensors/${band.sensor_id}`); return; }
			const cal = calStripAt(u, xCss, yCss);
			if (cal) { goto(`${base}/sensors/${cal.sensorId}?tab=calibrations&cal=${cal.calId}`); return; }
			// Two series can pass within a few pixels of each other at the same instant, so the
			// nearer candidate wins rather than whichever is tested first.
			const spot = spotPointAt(u, xCss, yCss);
			const point = continuousPointAt(u, xCss, yCss);
			if (spot && (!point || spot.distance <= point.distance)) {
				if (onpointclick) {
					onpointclick({
						timeMs: spot.timeMs,
						measurementType: 'spot',
						sampleId: spot.stats.sampleId ?? null,
					});
				} else {
					replicateTarget = { timeMs: spot.timeMs, stats: spot.stats };
					replicateOpen = true;
				}
				return;
			}
			if (point) onpointclick?.({ timeMs: point.timeMs, measurementType: 'continuous' });
		};
		over.addEventListener('mousedown', onDown);
		over.addEventListener('mousemove', onMove);
		over.addEventListener('mouseup', onUp);
		return () => {
			over.removeEventListener('mousedown', onDown);
			over.removeEventListener('mousemove', onMove);
			over.removeEventListener('mouseup', onUp);
		};
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

	function showCursor(p: CursorPoint) {
		if (!chart) return;
		chart.setCursor({ left: chart.valToPos(p.timeMs / 1000, 'x'), top: chart.valToPos(p.value, 'y') });
	}

	function openPoint(p: CursorPoint) {
		if (p.measurementType === 'continuous') {
			onpointclick?.({ timeMs: p.timeMs, measurementType: 'continuous' });
			return;
		}
		if (onpointclick) {
			onpointclick({ timeMs: p.timeMs, measurementType: 'spot', sampleId: p.sampleId });
			return;
		}
		const stats = spotStats?.get(p.timeMs);
		if (stats?.replicates?.length) {
			replicateTarget = { timeMs: p.timeMs, stats };
			replicateOpen = true;
		}
	}

	function onPlotKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			if (cursorIndex == null) return;
			e.preventDefault();
			openPoint(keyPoints[cursorIndex]);
			return;
		}
		if (e.key === 'Escape') {
			if (cursorIndex == null) return;
			e.preventDefault();
			cursorIndex = null;
			chart?.setCursor({ left: -10, top: -10 });
			return;
		}
		const next = stepCursor(cursorIndex, e.key, keyPoints.length);
		if (next == null) return;
		e.preventDefault();
		cursorIndex = next;
		showCursor(keyPoints[next]);
	}

	function cursorLabel(p: CursorPoint): string {
		return `${formatDateTime(new Date(p.timeMs))}, ${formatMeasurement(p.value, decimals)}${units ? ` ${units}` : ''}, ${p.measurementType}`;
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
		const zone = timezoneStore.zone;
		const start = new Date(a.start_time);
		const end = new Date(a.end_time);
		const sameDay =
			start.toLocaleDateString(undefined, { timeZone: zone }) ===
			end.toLocaleDateString(undefined, { timeZone: zone });
		return sameDay
			? `${formatInstant(start.getTime())} – ${formatClockTime(end)}`
			: `${formatInstant(start.getTime())} → ${formatInstant(end.getTime())}`;
	}

	function handleResize() {
		if (!chart || !el) return;
		const w = el.getBoundingClientRect().width;
		if (w > 0) chart.setSize({ width: w, height: 220 });
	}

	$effect(() => {
		// Read synchronously so a timezone-preference toggle re-runs this effect; renderChart()
		// (a microtask below) then rebuilds the chart with the new tzDate via tzDateOption().
		void timezoneStore.zone;
		// Dot mode widens the y-range to the replicate extremes, which is a rebuild, not a redraw.
		void showReplicates;
		// Splitting the slot by instrument adds or removes lines, so it is a rebuild too.
		void extraSeries.length;
		// The shared crosshair reads the continuous series when present, else the spot samples.
		const primary = hasContinuous ? chartData : spotData;
		if (hasData && primary) {
			syncGroup?.update(chartId, {
				times: primary.times,
				values: primary.values,
				threshold,
				flags: primary.flags ?? null,
				flagReasons: primary.flagReasons ?? null,
				annotations,
				sensorBands: showSensorVectors ? sensorBands : [],
				calibrationMarkers: showCalibrationMarkers ? calibrationMarkers : [],
				spotStats,
				spotFlags: publishedSpotFlags(),
				originLabel,
			});
			tick().then(() => renderChart());
		} else {
			// Nothing to draw: tear the plot down rather than leaving the previous window's series
			// on screen underneath the "No data" overlay.
			if (chart) { chart.destroy(); chart = null; }
			if (teardownCustomSelection) { teardownCustomSelection(); teardownCustomSelection = null; }
			syncGroup?.update(chartId, {
				times: [],
				values: [],
				threshold,
				flags: null,
				flagReasons: null,
				annotations,
				sensorBands: [],
				calibrationMarkers: [],
				spotStats: null,
				originLabel,
			});
		}
	});

	onMount(() => {
		syncGroup?.register({
			id: chartId,
			parameterName,
			units,
			decimals,
			paletteIndex: seriesIndex,
			times: [],
			values: [],
			threshold,
			flags: null,
			flagReasons: null,
			annotations: [],
			sensorBands: [],
			calibrationMarkers: [],
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
			{#if isDerived}<span class="ml-1.5 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-brand-accent/15 text-brand-accent-dark align-middle">derived</span>{/if}
			{#if externalSource}<span
					class="ml-1.5 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-brand-accent/15 text-brand-accent-dark align-middle"
					title="{externalSource.attribution}, station {externalSource.station}"
				>{externalSource.attribution}</span>{/if}
			{#if parameterCode}<span class="text-xs text-brand-muted font-normal font-mono ml-1.5">{parameterCode}</span>{/if}
			{#if hasData}<span class="text-xs text-brand-muted font-normal ml-2">{dataPoints} pts</span>{/if}
			{#if withdrawnCount > 0}
				<span
					class="text-xs text-brand-muted font-normal ml-2"
					title="Instants the source has taken back. Turn on Retracted to draw them; the retraction is reversible."
				>· {withdrawnCount} retracted</span>
			{/if}
		</span>
		<div class="flex items-center gap-1.5">
			{#if showAlarmBands && activeBreach}
				{@const isAlarm = activeBreach.severity >= 2}
				{@const since = activeBreach.started_at ?? activeBreach.since}
				<a
					href="{base}/alarms?site_id={siteId}&parameter_id={parameterId}"
					title="View this parameter's alarm log"
					class="flex items-center gap-1.5 px-2 py-0.5 text-xs rounded no-underline hover:underline {isAlarm ? 'text-severity-alarm bg-severity-alarm-soft' : 'text-severity-warning bg-severity-warning-soft'}"
				>
					<span class="inline-block w-2 h-2 rounded-full shrink-0 {isAlarm ? 'bg-severity-alarm' : 'bg-severity-warning-fill'}"></span>
					{isAlarm ? 'Alarm' : 'Warning'} active for {breachDuration(since)} since {formatDateTime(since)}
				</a>
			{/if}
			<Button variant="secondary" size="sm" onclick={() => startSelection('annotate')} title="Annotate a time range">Annotate</Button>
			<Button variant="danger" size="sm" onclick={() => startSelection('flag')} title="Flag readings in a range">Flag</Button>
			<Button variant="secondary" size="sm" onclick={() => startSelection('unflag')} title="Unflag readings in a range">Unflag</Button>
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
								<Button
									variant="danger"
									size="sm"
									class="px-1 py-0 leading-none text-[10px]"
									onclick={() => deleteAnnotation(a.id)}
									title="Confirm delete"
								>Delete?</Button>
								<button
									onclick={() => confirmDeleteId = null}
									class="text-brand-muted hover:text-brand-text cursor-pointer bg-transparent border-none px-0.5 leading-none text-sm"
									title="Cancel"
									aria-label="Cancel"
								>✕</button>
							{:else}
								<button
									onclick={() => confirmDeleteId = a.id}
									class="text-brand-muted hover:text-severity-alarm cursor-pointer bg-transparent border-none px-0.5 leading-none text-sm"
									title="Delete annotation"
									aria-label="Delete annotation"
								>×</button>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
	<!-- The plot carries its own keyboard model, which is what role="application" declares; svelte
	     classes the role as non-interactive and so flags the tabindex and the handler. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="px-1 py-1 relative outline-none focus-visible:ring-2 focus-visible:ring-brand-primary {selectionMode !== 'zoom' ? 'cursor-crosshair' : ''}"
		role="application"
		tabindex="0"
		aria-label="{parameterName} chart. Arrow keys move between points, Enter opens the point record."
		onkeydown={onPlotKeydown}
	>
		<div bind:this={el} class="w-full" style="min-height:220px"></div>
		{#if hasData}
			<ChartKey presence={keyPresence} seriesColor={seriesColor(seriesIndex)} />
		{/if}
		<div class="px-2 text-xs text-brand-muted" aria-live="polite">
			{#if cursorIndex != null && keyPoints[cursorIndex]}
				Point {cursorIndex + 1} of {keyPoints.length}: {cursorLabel(keyPoints[cursorIndex])}
			{/if}
		</div>
		{#if !hasData && !externalLoading}
			<div class="absolute inset-0 flex items-center justify-center text-sm text-brand-muted pointer-events-none">{emptyMessage}</div>
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

{#if replicateTarget}
	<ReplicateFlagDialog
		bind:open={replicateOpen}
		{siteId}
		{parameterId}
		{parameterName}
		{units}
		{decimals}
		timeIso={new Date(replicateTarget.timeMs).toISOString()}
		replicates={replicateTarget.stats.replicates ?? []}
		onsuccess={onDialogSuccess}
	/>
{/if}
