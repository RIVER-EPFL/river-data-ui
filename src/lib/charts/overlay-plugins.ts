import type uPlot from 'uplot';
import { tokens } from './tokens';
import type { SensorIdentityBand, CalibrationMarker } from '$api/sensors';

export interface OverlayVisibility {
	sensorVectors: boolean;
	calibrationMarkers: boolean;
	alarmBands: boolean;
}

/** Stable colour for a deployment id → one of the colorblind-safe dataViz hues, low alpha. */
export function bandColor(deploymentId: string, alpha = 0.14): string {
	let h = 0;
	for (let i = 0; i < deploymentId.length; i++) h = (h * 31 + deploymentId.charCodeAt(i)) | 0;
	const hex = tokens.dataViz[Math.abs(h) % tokens.dataViz.length];
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	return `rgba(${r},${g},${b},${alpha})`;
}

/** Height (CSS px) of the dark labelled strip at the top of each band - also the click target. */
export const BAND_STRIP_CSS = 16;

const bandLabel = (b: SensorIdentityBand) => b.sensor_name ?? b.sensor_serial ?? 'sensor';

/**
 * Sensor-identity bands. `bandsRef.current` and `visRef.current` are read live inside the
 * draw hook so toggling visibility only needs chart.redraw(), not a rebuild.
 * Each band draws a full-height tint plus a dark top strip carrying the sensor name; the strip
 * is the only clickable affordance (see ParameterChart's config-click handler).
 */
export function sensorVectorBandPlugin(
	bandsRef: { current: SensorIdentityBand[] },
	visRef: { current: OverlayVisibility },
): uPlot.Plugin {
	return {
		hooks: {
			draw: [
				(u: uPlot) => {
					if (!visRef.current.sensorVectors) return;
					const bands = bandsRef.current;
					if (!bands.length) return;
					const ctx = u.ctx;
					const dpr = (u as unknown as { pxRatio?: number }).pxRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1) ?? 1;
					const stripH = BAND_STRIP_CSS * dpr;
					const { left, top, width, height } = u.bbox;
					ctx.save();
					ctx.beginPath();
					ctx.rect(left, top, width, height);
					ctx.clip();
					ctx.textBaseline = 'middle';
					ctx.font = `600 ${11 * dpr}px ${tokens.font.body}`;
					const divW = 1.5 * dpr;
					for (const b of bands) {
						const ts0 = new Date(b.from).getTime() / 1000;
						const ts1 = b.until ? new Date(b.until).getTime() / 1000 : u.scales.x.max!;
						const x0 = Math.max(u.valToPos(ts0, 'x', true), left);
						const x1 = Math.min(u.valToPos(ts1, 'x', true), left + width);
						if (x1 <= x0) continue;
						ctx.fillStyle = bandColor(b.deployment_id, 0.1);
						ctx.fillRect(x0, top, x1 - x0, height);
						ctx.fillStyle = bandColor(b.deployment_id, 0.92);
						ctx.fillRect(x0, top, x1 - x0, stripH);
						ctx.fillStyle = tokens.brand.surface;
						ctx.fillRect(x0, top, divW, stripH);
						ctx.fillRect(x1 - divW, top, divW, stripH);
						if (x1 - x0 > 24 * dpr) {
							ctx.save();
							ctx.beginPath();
							ctx.rect(x0 + divW, top, x1 - x0 - 2 * divW, stripH);
							ctx.clip();
							ctx.fillStyle = '#ffffff';
							ctx.fillText(`${bandLabel(b)} ↗`, x0 + divW + 4 * dpr, top + stripH / 2 + dpr);
							ctx.restore();
						}
					}
					ctx.restore();
				},
			],
		},
	};
}

export const CALIBRATION_STRIP_CSS = 14;

const calLabel = (m: CalibrationMarker) =>
	m.intercept >= 0 ? `${m.slope}x + ${m.intercept}` : `${m.slope}x − ${Math.abs(m.intercept)}`;

/** Calibration-window strips drawn below the deployment strip. */
export function calibrationMarkerPlugin(
	markersRef: { current: CalibrationMarker[] },
	visRef: { current: OverlayVisibility },
): uPlot.Plugin {
	return {
		hooks: {
			draw: [
				(u: uPlot) => {
					if (!visRef.current.calibrationMarkers) return;
					const markers = markersRef.current;
					if (!markers.length) return;
					const ctx = u.ctx;
					const dpr = (u as unknown as { pxRatio?: number }).pxRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1) ?? 1;
					const sensorStripH = BAND_STRIP_CSS * dpr;
					const calStripH = CALIBRATION_STRIP_CSS * dpr;
					const { left, top, width } = u.bbox;
					const stripTop = top + sensorStripH;
					ctx.save();
					ctx.beginPath();
					ctx.rect(left, top, width, u.bbox.height);
					ctx.clip();
					ctx.textBaseline = 'middle';
					ctx.font = `600 ${10 * dpr}px ${tokens.font.body}`;
					const calDivW = 2 * dpr;
					for (const m of markers) {
						const ts0 = new Date(m.valid_from).getTime() / 1000;
						const ts1 = m.valid_until ? new Date(m.valid_until).getTime() / 1000 : u.scales.x.max!;
						const x0 = Math.max(u.valToPos(ts0, 'x', true), left);
						const x1 = Math.min(u.valToPos(ts1, 'x', true), left + width);
						if (x1 <= x0) continue;
						ctx.fillStyle = `rgba(199,119,0,0.85)`;
						ctx.fillRect(x0, stripTop, x1 - x0, calStripH);
						ctx.fillStyle = tokens.brand.surface;
						ctx.fillRect(x0, stripTop, calDivW, calStripH);
						ctx.fillRect(x1 - calDivW, stripTop, calDivW, calStripH);
						if (x1 - x0 > 20 * dpr) {
							ctx.save();
							ctx.beginPath();
							ctx.rect(x0 + calDivW, stripTop, x1 - x0 - 2 * calDivW, calStripH);
							ctx.clip();
							ctx.fillStyle = '#ffffff';
							ctx.fillText(calLabel(m), x0 + calDivW + 3 * dpr, stripTop + calStripH / 2 + dpr);
							ctx.restore();
						}
					}
					ctx.restore();
				},
			],
		},
	};
}

// ── Calibration editor window band ──────────────────────────────────────────

export interface CalibrationWindowBand {
	fromSec: number;
	toSec: number;
}

/** Shaded rectangle over the editable calibration window. */
export function calibrationWindowBandPlugin(
	bandRef: { current: CalibrationWindowBand | null },
): uPlot.Plugin {
	return {
		hooks: {
			draw: [
				(u: uPlot) => {
					const band = bandRef.current;
					if (!band) return;
					const ctx = u.ctx;
					const dpr = (u as unknown as { pxRatio?: number }).pxRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1) ?? 1;
					const { left, top, width, height } = u.bbox;
					const ts1 = band.toSec === Infinity ? u.scales.x.max! : band.toSec;
					const x0 = Math.max(u.valToPos(band.fromSec, 'x', true), left);
					const x1 = Math.min(u.valToPos(ts1, 'x', true), left + width);
					if (x1 <= x0) return;
					ctx.save();
					ctx.fillStyle = `rgba(199,119,0,0.08)`;
					ctx.fillRect(x0, top, x1 - x0, height);
					ctx.strokeStyle = `rgba(199,119,0,0.5)`;
					ctx.lineWidth = 1;
					ctx.setLineDash([]);
					ctx.beginPath();
					ctx.moveTo(x0, top);
					ctx.lineTo(x0, top + height);
					ctx.moveTo(x1, top);
					ctx.lineTo(x1, top + height);
					ctx.stroke();
					ctx.restore();
				},
			],
		},
	};
}

// ── Warning/alarm severity bands ──────────────────────────────────────────────
// Contiguous time spans where the plotted value breached its threshold, painted along
// the x-axis like sensor-identity bands. Severity is derived from the same threshold the
// tooltip uses, so the bands and the tooltip badge always agree.

export interface AlarmSeverityBand {
	/** Inclusive span in epoch seconds. */
	fromTs: number;
	toTs: number;
	/** 1 = warning, 2 = alarm. */
	severity: 1 | 2;
}

interface ThresholdLike {
	warning_min?: number | null;
	warning_max?: number | null;
	alarm_min?: number | null;
	alarm_max?: number | null;
}

/** Severity of a single value against a threshold: 0 ok, 1 warning, 2 alarm (alarm wins). */
export function severityForValue(v: number | null | undefined, t: ThresholdLike | null | undefined): 0 | 1 | 2 {
	if (v == null || t == null) return 0;
	if ((t.alarm_min != null && v < t.alarm_min) || (t.alarm_max != null && v > t.alarm_max)) return 2;
	if ((t.warning_min != null && v < t.warning_min) || (t.warning_max != null && v > t.warning_max)) return 1;
	return 0;
}

/** Coalesce per-point breaches into contiguous same-severity time bands. Nulls/gaps close a band. */
export function computeSeverityBands(
	times: number[],
	values: (number | null)[],
	t: ThresholdLike | null | undefined,
): AlarmSeverityBand[] {
	if (t == null || times.length === 0) return [];
	const bands: AlarmSeverityBand[] = [];
	let cur: AlarmSeverityBand | null = null;
	for (let i = 0; i < times.length; i++) {
		const sev = severityForValue(values[i], t);
		if (sev > 0) {
			if (cur && cur.severity === sev) {
				cur.toTs = times[i];
			} else {
				if (cur) bands.push(cur);
				cur = { fromTs: times[i], toTs: times[i], severity: sev as 1 | 2 };
			}
		} else if (cur) {
			bands.push(cur);
			cur = null;
		}
	}
	if (cur) bands.push(cur);
	return bands;
}

const severityFill = { 1: tokens.severity.warning.soft, 2: tokens.severity.alarm.soft } as const;
const severityStrip = { 1: tokens.severity.warning.main, 2: tokens.severity.alarm.main } as const;

/** Height (CSS px) of the solid strip along the bottom edge marking a breach span. */
export const ALARM_STRIP_CSS = 4;

/**
 * Warning/alarm severity bands. Mirrors sensorVectorBandPlugin: a full-height severity tint plus
 * a thin solid strip at the BOTTOM edge (sensor bands own the top strip), read live via refs.
 */
export function alarmBandPlugin(
	bandsRef: { current: AlarmSeverityBand[] },
	visRef: { current: OverlayVisibility },
): uPlot.Plugin {
	return {
		hooks: {
			draw: [
				(u: uPlot) => {
					if (!visRef.current.alarmBands) return;
					const bands = bandsRef.current;
					if (!bands.length) return;
					const ctx = u.ctx;
					const dpr = (u as unknown as { pxRatio?: number }).pxRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1) ?? 1;
					const stripH = ALARM_STRIP_CSS * dpr;
					const { left, top, width, height } = u.bbox;
					ctx.save();
					ctx.beginPath();
					ctx.rect(left, top, width, height);
					ctx.clip();
					for (const b of bands) {
						const x0 = Math.max(u.valToPos(b.fromTs, 'x', true), left);
						let x1 = Math.min(u.valToPos(b.toTs, 'x', true), left + width);
						if (x1 < x0) continue;
						if (x1 - x0 < 2 * dpr) x1 = x0 + 2 * dpr; // keep single-point breaches visible
						ctx.fillStyle = severityFill[b.severity];
						ctx.fillRect(x0, top, x1 - x0, height);
						ctx.fillStyle = severityStrip[b.severity];
						ctx.fillRect(x0, top + height - stripH, x1 - x0, stripH);
					}
					ctx.restore();
				},
			],
		},
	};
}

/** Hit-test: the severity band covering an x timestamp (seconds), for the tooltip. */
export function severityBandAtTime(bands: AlarmSeverityBand[], tsSec: number): AlarmSeverityBand | null {
	for (const b of bands) {
		if (tsSec >= b.fromTs && tsSec <= b.toTs) return b;
	}
	return null;
}

/** Hit-test: which band contains an x timestamp (seconds), for hover → config link. */
export function bandAtTime(bands: SensorIdentityBand[], tsSec: number): SensorIdentityBand | null {
	for (const b of bands) {
		const t0 = new Date(b.from).getTime() / 1000;
		const t1 = b.until ? new Date(b.until).getTime() / 1000 : Infinity;
		if (tsSec >= t0 && tsSec < t1) return b;
	}
	return null;
}

/** Hit-test: which calibration's [valid_from, valid_until) window contains an x timestamp (seconds). */
export function calibrationAtTime(markers: CalibrationMarker[], tsSec: number): CalibrationMarker | null {
	for (const m of markers) {
		const t0 = new Date(m.valid_from).getTime() / 1000;
		const t1 = m.valid_until ? new Date(m.valid_until).getTime() / 1000 : Infinity;
		if (tsSec >= t0 && tsSec < t1) return m;
	}
	return null;
}
