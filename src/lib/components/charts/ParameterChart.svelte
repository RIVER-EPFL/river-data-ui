<script lang="ts">
	import { onMount, tick } from 'svelte';
	import uPlot from 'uplot';
	import 'uplot/dist/uPlot.min.css';
	import { uPlotTheme, makeSeries, makeAxis, makeGaps, tzDateOption } from '$lib/charts/uPlotTheme';
	import { timezoneStore } from '$lib/stores/timezone.svelte';
	import { tokens } from '$lib/charts/tokens';
	import { getChartSyncGroup } from '$lib/charts/chart-sync.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { api, type AlarmThreshold, type Annotation } from '$api/crud';
	import AnnotateDialog from '$components/dialogs/AnnotateDialog.svelte';
	import FlagDialog from '$components/dialogs/FlagDialog.svelte';
	import {
		sensorVectorBandPlugin, calibrationMarkerPlugin, bandAtTime, calibrationAtTime,
		BAND_STRIP_CSS, CALIBRATION_STRIP_CSS,
		alarmBandPlugin, computeSeverityBands, type AlarmSeverityBand,
		type OverlayVisibility,
	} from '$lib/charts/overlay-plugins';
	import type { SensorIdentityBand, CalibrationMarker } from '$api/sensors';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { formatDateTime } from '$lib/utils';

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
		threshold,
		annotations = [],
		seriesIndex = 0,
		syncKey = '',
		chartData,
		spotData = null,
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
		activeBreach = null,
		nowMs = 0,
	}: {
		siteId: string;
		siteParameterId: string;
		parameterId: string;
		parameterName: string;
		parameterCode?: string;
		units?: string;
		threshold?: AlarmThreshold | null;
		annotations?: Annotation[];
		seriesIndex?: number;
		syncKey?: string;
		chartData?: ChartData | null;
		/** Discrete spot/grab samples (measurement_type='spot'), drawn as unconnected diamond
		 *  markers. When present without chartData, only the markers render (no continuous line). */
		spotData?: ChartData | null;
		gapThreshold?: number;
		loading?: boolean;
		onZoomSelect?: (startMs: number, endMs: number) => void;
		onResetZoom?: () => void;
		onSaved?: () => void;
		sensorBands?: SensorIdentityBand[];
		calibrationMarkers?: CalibrationMarker[];
		showSensorVectors?: boolean;
		showCalibrationMarkers?: boolean;
		showAlarmBands?: boolean;
		isDerived?: boolean;
		/** Live active breach for this parameter (from getActiveAlarms), shown as a header badge. */
		activeBreach?: { severity: number; started_at?: string | null; since: string } | null;
		/** Ticking clock (ms) from the parent so the badge's "active for …" stays fresh. */
		nowMs?: number;
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
	let pendingRange = $state<{ startMs: number; endMs: number } | null>(null);

	let userExpansionPref = $state<boolean | null>(null);
	const annotationsExpanded = $derived(userExpansionPref ?? annotations.length <= 5);
	function toggleAnnotationsExpanded() {
		userExpansionPref = !annotationsExpanded;
	}

	const hasContinuous = $derived(chartData != null && chartData.times.length > 0);
	const hasSpot = $derived(spotData != null && spotData.times.length > 0);
	const hasData = $derived(hasContinuous || hasSpot);
	const dataPoints = $derived((chartData?.times.length ?? 0) + (spotData?.times.length ?? 0));

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

	// Draws spot/grab samples as unconnected diamonds (matching the dashboard grab-sample markers).
	// The values live in a real uPlot series (so they range the y-scale) that is rendered
	// transparently with points off; this plugin paints the diamonds from that series' data.
	function spotDiamondPlugin(seriesIdx: number): uPlot.Plugin {
		if (seriesIdx < 0) return { hooks: {} };
		return {
			hooks: {
				draw: [
					(u: uPlot) => {
						const xData = u.data[0] as number[];
						const vData = u.data[seriesIdx] as (number | undefined)[];
						if (!xData || !vData) return;
						const ctx = u.ctx;
						const { left, top, width, height } = u.bbox;
						ctx.save();
						ctx.beginPath();
						ctx.rect(left, top, width, height);
						ctx.clip();
						const size = 5;
						ctx.fillStyle = uPlotTheme.grabSampleFill;
						ctx.strokeStyle = uPlotTheme.grabSampleStroke;
						ctx.lineWidth = 1.5;
						for (let i = 0; i < xData.length; i++) {
							const val = vData[i];
							if (val == null) continue;
							const x = u.valToPos(xData[i], 'x', true);
							const y = u.valToPos(val, 'y', true);
							ctx.beginPath();
							ctx.moveTo(x, y - size);
							ctx.lineTo(x + size, y);
							ctx.lineTo(x, y + size);
							ctx.lineTo(x - size, y);
							ctx.closePath();
							ctx.fill();
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
		} else if (cont) {
			times = cont.times;
			contValues = toU(cont.values);
			if (hasMinMax) { contMins = toU(cont.mins!); contMaxs = toU(cont.maxs!); }
			flags = cont.flags ?? null;
		} else {
			times = spot!.times;
			spotValues = toU(spot!.values);
			flags = spot!.flags ?? null;
		}

		// Series layout: index 1 is the continuous line (or, when there is no line, the spot
		// markers themselves so the y-scale still ranges). thresholdLinePlugin/flaggedPointPlugin
		// read series 1, and the min/max band references series [3, 2] — keep spot after those.
		const seriesDefs: uPlot.Series[] = [{}];
		const data: uPlot.AlignedData = [times] as any;
		let spotSeriesIdx = -1;

		if (cont) {
			seriesDefs.push({ ...makeSeries(seriesIndex, parameterName, units), gaps });
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
				spotDiamondPlugin(spotSeriesIdx),
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
		const teardownSelect = setupCustomSelection(chart);
		const teardownClick = setupConfigClick(chart);
		teardownCustomSelection = () => { teardownSelect(); teardownClick(); };

		if (onResetZoom) {
			chart.root.addEventListener('dblclick', () => onResetZoom!());
		}
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
			over.style.cursor = bandStripAt(u, xCss, yCss) || calStripAt(u, xCss, yCss) ? 'pointer' : '';
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
		const sameDay = start.toLocaleDateString('en-US', { timeZone: zone }) === end.toLocaleDateString('en-US', { timeZone: zone });
		const fmt = (d: Date) => d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: zone, timeZoneName: 'short' });
		return sameDay
			? `${fmt(start)} – ${end.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: zone })}`
			: `${fmt(start)} → ${fmt(end)}`;
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
			{#if isDerived}<span class="ml-1.5 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-brand-accent/15 text-brand-accent align-middle">derived</span>{/if}
			{#if parameterCode}<span class="text-xs text-brand-muted font-normal font-mono ml-1.5">{parameterCode}</span>{/if}
			{#if hasData}<span class="text-xs text-brand-muted font-normal ml-2">{dataPoints} pts</span>{/if}
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
					<span class="inline-block w-2 h-2 rounded-full shrink-0 {isAlarm ? 'bg-severity-alarm' : 'bg-severity-warning'}"></span>
					{isAlarm ? 'Alarm' : 'Warning'} active for {breachDuration(since)} since {formatDateTime(since)}
				</a>
			{/if}
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
