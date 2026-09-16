/** The part of uPlot a hit test needs: the mapping between a value and a pixel. */
export interface Scale {
	posToVal(pos: number, axis: 'x'): number;
	valToPos(val: number, axis: 'x' | 'y'): number;
}

export interface PointHit {
	timeMs: number;
	distance: number;
}

export interface Tolerance {
	x: number;
	y: number;
}

/**
 * The continuous reading under a click: nearest in x, and vertically close to the line.
 *
 * `times` carries the chart's own x scale, which is seconds; the hit is an instant, so it is
 * returned in milliseconds.
 */
export function continuousPointAt(
	scale: Scale,
	xCss: number,
	yCss: number,
	times: number[],
	values: (number | null)[],
	tolerance: Tolerance,
): PointHit | null {
	if (times.length === 0) return null;
	const targetSec = scale.posToVal(xCss, 'x');
	let lo = 0;
	let hi = times.length - 1;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (times[mid] < targetSec) lo = mid + 1;
		else hi = mid;
	}
	let best: PointHit | null = null;
	for (let i = Math.max(0, lo - 2); i <= Math.min(times.length - 1, lo + 2); i++) {
		const value = values[i];
		if (value == null) continue;
		const dx = Math.abs(scale.valToPos(times[i], 'x') - xCss);
		const dy = Math.abs(scale.valToPos(value, 'y') - yCss);
		if (dx > tolerance.x || dy > tolerance.y) continue;
		const distance = Math.hypot(dx, dy);
		if (!best || distance < best.distance) best = { timeMs: times[i] * 1000, distance };
	}
	return best;
}
