import type { SpotPointStats } from './spotMarkers';

export interface CursorPoint {
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
			const stat = stats?.get(t);
			out.push({ timeMs: t, value: stat?.mean ?? v, measurementType: 'spot', sampleId: stat?.sampleId ?? null });
		});
	}
	if (continuous && exactTimes) {
		continuous.times.forEach((t, i) => {
			const v = continuous.values[i];
			if (v == null) return;
			out.push({ timeMs: t, value: v, measurementType: 'continuous', sampleId: null });
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
