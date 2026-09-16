import type { SpotPointStats } from './spotMarkers';

export interface CursorPoint {
	/** The reading's instant. The series it came from carry the chart's own scale, seconds. */
	timeMs: number;
	value: number;
	measurementType: 'continuous' | 'spot';
	sampleId: string | null;
}

interface Series {
	times: number[];
	values: (number | null)[];
}

/**
 * Every point the keyboard cursor can land on, in time order. Spot points always count; continuous
 * ones only when the times are stored instants, since an aggregate bucket start resolves no reading.
 *
 * Both series carry the chart's x scale, seconds; a cursor point carries the instant, milliseconds,
 * which is what a point record and the spot statistics are keyed by.
 */
export function cursorPoints(
	continuous: Series | null,
	spot: Series | null,
	stats: Map<number, SpotPointStats> | null,
	exactTimes: boolean,
): CursorPoint[] {
	const out: CursorPoint[] = [];
	if (spot) {
		spot.times.forEach((t, i) => {
			const v = spot.values[i];
			if (v == null) return;
			const timeMs = t * 1000;
			const stat = stats?.get(timeMs);
			out.push({ timeMs, value: stat?.mean ?? v, measurementType: 'spot', sampleId: stat?.sampleId ?? null });
		});
	}
	if (continuous && exactTimes) {
		continuous.times.forEach((t, i) => {
			const v = continuous.values[i];
			if (v == null) return;
			out.push({ timeMs: t * 1000, value: v, measurementType: 'continuous', sampleId: null });
		});
	}
	return out.sort((a, b) => a.timeMs - b.timeMs || (a.measurementType === 'spot' ? -1 : 1));
}

/** The index a key moves the cursor to, or null for a key the cursor does not handle. */
export function stepCursor(index: number | null, key: string, length: number): number | null {
	if (length === 0) return null;
	const last = length - 1;
	const page = Math.max(1, Math.round(length / 10));
	switch (key) {
		case 'ArrowRight':
			return index == null ? 0 : Math.min(last, index + 1);
		case 'ArrowLeft':
			return index == null ? last : Math.max(0, index - 1);
		case 'PageDown':
			return Math.min(last, (index ?? -1) + page);
		case 'PageUp':
			return Math.max(0, (index ?? length) - page);
		case 'Home':
			return 0;
		case 'End':
			return last;
		default:
			return null;
	}
}
