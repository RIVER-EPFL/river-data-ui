// Shared rendering for low-frequency (spot/grab) points on uPlot charts.
//
// Spot values live in a real uPlot series so they range the y-scale, but that series is rendered
// transparently (no line, no built-in points); the plugin paints diamond markers — and, when
// replicate statistics are available, mean±sd whiskers — from the series data. Hard-won field
// data stays visible at any zoom, unlike line rendering where an isolated point disappears.

import type uPlot from 'uplot';
import { uPlotTheme } from './uPlotTheme';

/** Replicate statistics for a spot point (from the trigger-maintained `samples` table). */
export interface SpotPointStats {
	mean: number;
	stdev: number | null;
	n: number;
}

export interface SpotSeriesSpec {
	/** Index of the transparent spot series in `u.data`. */
	seriesIdx: number;
	fill?: string;
	stroke?: string;
	/** mean±sd whiskers keyed by x value (seconds). Only drawn for entries with n ≥ 2 and a stdev. */
	stats?: Map<number, SpotPointStats>;
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

export function drawDiamond(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	size: number,
): void {
	ctx.beginPath();
	ctx.moveTo(x, y - size);
	ctx.lineTo(x + size, y);
	ctx.lineTo(x, y + size);
	ctx.lineTo(x - size, y);
	ctx.closePath();
	ctx.fill();
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
						const size = spotMarkerSize(pointCount);
						ctx.save();
						ctx.beginPath();
						ctx.rect(left, top, width, height);
						ctx.clip();
						ctx.fillStyle = spec.fill ?? uPlotTheme.grabSampleFill;
						ctx.strokeStyle = spec.stroke ?? uPlotTheme.grabSampleStroke;
						ctx.lineWidth = 1.5;
						for (let i = 0; i < xData.length; i++) {
							const val = vData[i];
							if (val == null) continue;
							const x = u.valToPos(xData[i], 'x', true);
							const y = u.valToPos(val, 'y', true);
							const stat = spec.stats?.get(xData[i]);
							if (stat && stat.n >= 2 && stat.stdev != null && stat.stdev > 0) {
								drawWhisker(ctx, u, x, stat.mean, stat.stdev, size);
							}
							drawDiamond(ctx, x, y, size);
						}
						ctx.restore();
					}
				},
			],
		},
	};
}
