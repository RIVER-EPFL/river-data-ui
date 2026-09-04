// Shared rendering for low-frequency (spot/grab) points on uPlot charts.
//
// Spot values live in a real uPlot series so they range the y-scale, but that series is rendered
// transparently (no line, no built-in points); the plugin paints diamond markers, and, when
// replicate statistics are available, mean±sd whiskers, from the series data. Hard-won field
// data stays visible at any zoom, unlike line rendering where an isolated point disappears.

import type uPlot from 'uplot';
import type { SampleReplicate } from '$api/types';
import { uPlotTheme } from './uPlotTheme';
import { spotDispersion } from './spotSummary';

/** Replicate statistics for a spot point (from the trigger-maintained `samples` table). */
export interface SpotPointStats {
	mean: number;
	stdev: number | null;
	n: number;
	// The observed range of the group's replicates. The bar drawn is one sd, so the extremes are
	// reported as numbers rather than as a second mark.
	min?: number | null;
	max?: number | null;
	// The whole group is retracted at source: served only when asked for, and drawn as a state
	// rather than an absence, because a retraction is reversible.
	withdrawn?: boolean;
	// The divisor this group's sd was computed with. A per-instant audit decision overrides the
	// slot's declaration, so the group's own value wins over the slot's wherever the sd is printed.
	sdEstimator?: 'sample' | 'population' | null;
	sdEstimatorSource?: string | null;
	// Individual replicate values behind the mean, each carrying its own curve references.
	replicates?: SampleReplicate[];
	// The `samples` row behind the point. Carried so a chart click can reach the sample's tool-run
	// provenance, which is stored on that row and not on the readings.
	sampleId?: string;
	// Curve references of the point itself, present when the fetch asked for include_curves.
	// Both are independently nullable: null is "no curve of that kind was applied".
	calibrationId?: string | null;
	standardCurveId?: string | null;
}

export interface SpotSeriesSpec {
	/** Index of the transparent spot series in `u.data`. */
	seriesIdx: number;
	fill?: string;
	stroke?: string;
	/** mean±sd whiskers keyed by x value (seconds). Only drawn for entries with n ≥ 2 and a stdev. */
	stats?: Map<number, SpotPointStats>;
	/** Whether the point at this data index is flagged. Drawn with the flagged glyph. */
	flagged?: (i: number) => boolean;
	/** Plot every stored replicate as its own dot alongside the group's mean. Opt-in. */
	showReplicates?: boolean;
}

/** Transparent uPlot series carrying spot values: ranges the y-scale, draws nothing itself. */
export function spotSeriesConfig(label: string): uPlot.Series {
	return {
		label,
		stroke: 'transparent',
		width: 0,
		points: { show: false },
	};
}

/** Marker size scales up when a series is sparse, so a lone campaign result reads at a glance. */
export function spotMarkerSize(pointCount: number): number {
	if (pointCount <= 30) return 6;
	if (pointCount <= 200) return 5;
	return 4;
}

/** `filled` false leaves the outline alone, the glyph for a single unreplicated measurement. */
export function drawDiamond(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	size: number,
	filled = true,
): void {
	ctx.beginPath();
	ctx.moveTo(x, y - size);
	ctx.lineTo(x + size, y);
	ctx.lineTo(x, y + size);
	ctx.lineTo(x - size, y);
	ctx.closePath();
	if (filled) ctx.fill();
	ctx.stroke();
}

/** The mark for a replicated group whose replicates agree: the caps of a bar of zero length. */
export function drawAgreedTick(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	size: number,
): void {
	ctx.beginPath();
	ctx.moveTo(x - size * 1.6, y);
	ctx.lineTo(x + size * 1.6, y);
	ctx.stroke();
}

/** A hollow ring, the glyph for an instant the source has taken back. */
export function drawWithdrawnRing(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	size: number,
): void {
	ctx.beginPath();
	ctx.arc(x, y, size, 0, Math.PI * 2);
	ctx.stroke();
}

/** A cross through a point, the glyph for a flagged value. */
export function drawFlagCross(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	size: number,
): void {
	ctx.beginPath();
	ctx.moveTo(x - size, y - size);
	ctx.lineTo(x + size, y + size);
	ctx.moveTo(x + size, y - size);
	ctx.lineTo(x - size, y + size);
	ctx.stroke();
}

function drawWhisker(
	ctx: CanvasRenderingContext2D,
	u: uPlot,
	x: number,
	mean: number,
	stdev: number,
	size: number,
): void {
	const yLo = u.valToPos(mean - stdev, 'y', true);
	const yHi = u.valToPos(mean + stdev, 'y', true);
	const cap = size;
	ctx.beginPath();
	ctx.moveTo(x, yHi);
	ctx.lineTo(x, yLo);
	ctx.moveTo(x - cap, yHi);
	ctx.lineTo(x + cap, yHi);
	ctx.moveTo(x - cap, yLo);
	ctx.lineTo(x + cap, yLo);
	ctx.stroke();
}

/**
 * The `[min, max]` a set of spot points occupies once their whiskers are drawn, or `null` when
 * nothing has one. uPlot ranges y from the series values, which are the means, so a bar wider than
 * the spread of the means is clipped at the plot edge and reads as a full-height line with no caps.
 * `includeRange` widens it to the observed replicate extremes, which is what dot mode draws.
 */
export function spotWhiskerExtent(
	stats: Iterable<SpotPointStats> | undefined,
	includeRange = false,
): [number, number] | null {
	let lo = Number.POSITIVE_INFINITY;
	let hi = Number.NEGATIVE_INFINITY;
	for (const s of stats ?? []) {
		const sd = s.stdev != null && s.n >= 2 && s.stdev > 0 ? s.stdev : 0;
		if (!Number.isFinite(s.mean)) continue;
		lo = Math.min(lo, s.mean - sd);
		hi = Math.max(hi, s.mean + sd);
		// A replicate outside mean±sd is drawn only in dot mode, and is clipped without this.
		if (includeRange && s.min != null && s.max != null) {
			lo = Math.min(lo, s.min);
			hi = Math.max(hi, s.max);
		}
	}
	return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null;
}

/** Whether some, but not all, of a group's replicates are excluded from its mean. */
export function partiallyCurated(stat: SpotPointStats | undefined): boolean {
	const reps = stat?.replicates ?? [];
	if (reps.length < 2) return false;
	const excluded = reps.filter((r) => r.flagged || r.withdrawn).length;
	return excluded > 0 && excluded < reps.length;
}

/**
 * Each replicate as its own dot, offset by a fixed number of pixels per index so identical values
 * stay countable, and coloured by whether curation excluded it from the mean.
 */
function drawReplicateDots(
	ctx: CanvasRenderingContext2D,
	u: uPlot,
	x: number,
	stat: SpotPointStats,
	size: number,
	stroke: string,
): void {
	const reps = stat.replicates ?? [];
	if (reps.length < 2) return;
	const radius = Math.max(1.5, size * 0.35);
	const spread = size * 1.1;
	const first = (reps.length - 1) / 2;
	reps.forEach((rep, i) => {
		const value = rep.calibrated_value ?? rep.raw_value;
		if (value == null || !Number.isFinite(value)) return;
		const cx = x + (i - first) * spread;
		const cy = u.valToPos(value, 'y', true);
		ctx.save();
		ctx.beginPath();
		ctx.arc(cx, cy, radius, 0, Math.PI * 2);
		ctx.fillStyle = rep.flagged || rep.withdrawn ? uPlotTheme.flaggedColor : stroke;
		ctx.globalAlpha = rep.withdrawn ? 0.4 : 0.85;
		ctx.fill();
		ctx.restore();
	});
}

/**
 * Paint diamond markers (and whiskers where stats exist) for each spot series. `specs` is a
 * callback so callers can rebuild the series list reactively without recreating the plugin.
 */
export function spotMarkersPlugin(specs: () => SpotSeriesSpec[]): uPlot.Plugin {
	return {
		hooks: {
			draw: [
				(u: uPlot) => {
					const xData = u.data[0] as number[];
					if (!xData) return;
					const ctx = u.ctx;
					const { left, top, width, height } = u.bbox;
					for (const spec of specs()) {
						if (spec.seriesIdx < 1) continue;
						const vData = u.data[spec.seriesIdx] as (number | null | undefined)[];
						if (!vData) return;
						const pointCount = vData.reduce<number>((acc, v) => acc + (v == null ? 0 : 1), 0);
						// Positions come back in canvas pixels, so the sizes drawn against them are
						// canvas pixels too: without this a 6 px diamond is 3 CSS px on a 2x display
						// and the caps that make an error bar readable all but vanish.
						const ratio =
							(u as unknown as { pxRatio?: number }).pxRatio ??
							(typeof window !== 'undefined' ? window.devicePixelRatio : 1) ??
							1;
						const size = spotMarkerSize(pointCount) * ratio;
						ctx.save();
						ctx.beginPath();
						ctx.rect(left, top, width, height);
						ctx.clip();
						ctx.fillStyle = spec.fill ?? uPlotTheme.grabSampleFill;
						ctx.strokeStyle = spec.stroke ?? uPlotTheme.grabSampleStroke;
						ctx.lineWidth = 1.5 * ratio;
						for (let i = 0; i < xData.length; i++) {
							const val = vData[i];
							if (val == null) continue;
							const x = u.valToPos(xData[i], 'x', true);
							const y = u.valToPos(val, 'y', true);
							const stat = spec.stats?.get(xData[i]);
							// Three states, three marks: a bar for spread, a bare rule for a group
							// whose replicates agree, an open diamond for a single measurement.
							const dispersion = spotDispersion(stat);
							if (dispersion === 'spread' && stat) {
								drawWhisker(ctx, u, x, stat.mean, stat.stdev as number, size);
							} else if (dispersion === 'agreed') {
								drawAgreedTick(ctx, x, y, size);
							}
							// A group some of whose replicates were curated away is drawn in the
							// flagged colour: the value is still served, but it no longer stands on
							// everything that was measured, and the whisker alone cannot say that.
							// A retracted instant is drawn faintly with a ring: still there, no longer
							// served, and one action from being back.
							if (stat?.withdrawn) {
								ctx.save();
								ctx.globalAlpha = 0.45;
								ctx.setLineDash([3 * ratio, 2 * ratio]);
								drawWithdrawnRing(ctx, x, y, size);
								drawDiamond(ctx, x, y, size * 0.6, false);
								ctx.restore();
								continue;
							}
							const flagged = spec.flagged?.(i) ?? false;
							const partial = !flagged && partiallyCurated(stat);
							if (flagged || partial) ctx.strokeStyle = uPlotTheme.flaggedColor;
							drawDiamond(ctx, x, y, size, dispersion !== 'single');
							if (spec.showReplicates && stat) {
								drawReplicateDots(
									ctx,
									u,
									x,
									stat,
									size,
									spec.stroke ?? uPlotTheme.grabSampleStroke,
								);
							}
							// A fully flagged group takes the cross; a partially curated one keeps
							// the outline alone, so the two states stay distinguishable.
							if (flagged) drawFlagCross(ctx, x, y, size);
							if (flagged || partial) ctx.strokeStyle = spec.stroke ?? uPlotTheme.grabSampleStroke;
						}
						ctx.restore();
					}
				},
			],
		},
	};
}
