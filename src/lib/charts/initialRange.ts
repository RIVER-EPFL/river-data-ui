// The window a site's charts open on.
//
// A week of the tail is the right default for a logger and the wrong one for grab data, where a
// week usually holds one visit or none: a spot-only site opened that way shows empty charts until
// the operator drags the slider back. Spot cadences therefore open on the span their own data
// covers.

export interface ParameterExtent {
	data_start?: string | null;
	data_end?: string | null;
	reading_count?: number | null;
	has_continuous?: boolean;
	has_spot?: boolean;
	frequency?: 'high' | 'low' | 'mixed';
}

export type Cadence = 'high' | 'low' | 'all';

export const DEFAULT_WINDOW_MS = 604_800_000;

const ms = (t: string | null | undefined): number | null => {
	if (!t) return null;
	const v = new Date(t).getTime();
	return Number.isFinite(v) ? v : null;
};

/** The span the parameters holding spot data cover, or null when none of them report one. */
function spotSpan(extents: ParameterExtent[]): { startMs: number; endMs: number } | null {
	let lo = Number.POSITIVE_INFINITY;
	let hi = Number.NEGATIVE_INFINITY;
	for (const p of extents) {
		if (!p.has_spot || (p.reading_count ?? 0) <= 0) continue;
		const start = ms(p.data_start);
		const end = ms(p.data_end);
		if (start != null) lo = Math.min(lo, start);
		if (end != null) hi = Math.max(hi, end);
	}
	return Number.isFinite(lo) && Number.isFinite(hi) ? { startMs: lo, endMs: hi } : null;
}

/** Whether any continuous parameter reaches into `[startMs, endMs]`. */
function continuousInside(extents: ParameterExtent[], startMs: number, endMs: number): boolean {
	return extents.some((p) => {
		if (!p.has_continuous || (p.reading_count ?? 0) <= 0) return false;
		const start = ms(p.data_start) ?? Number.NEGATIVE_INFINITY;
		const end = ms(p.data_end) ?? Number.POSITIVE_INFINITY;
		return end >= startMs && start <= endMs;
	});
}

export function initialChartRange(
	extents: ParameterExtent[],
	bounds: { minMs: number; maxMs: number },
	cadence: Cadence,
): { startMs: number; endMs: number } {
	const week = {
		startMs: Math.max(bounds.minMs, bounds.maxMs - DEFAULT_WINDOW_MS),
		endMs: bounds.maxMs,
	};
	const withData = extents.filter((p) => (p.reading_count ?? 0) > 0);
	const spotOnly = withData.length > 0 && withData.every((p) => p.frequency === 'low');

	let range = week;
	if (cadence === 'low' || spotOnly) {
		range = spotSpan(extents) ?? week;
	} else if (cadence === 'all' && !continuousInside(extents, week.startMs, week.endMs)) {
		range = spotSpan(extents) ?? week;
	}

	// The readings API rejects a zero-width range, and a single-instant site produces one.
	if (range.startMs >= range.endMs) {
		return { startMs: range.endMs - DEFAULT_WINDOW_MS, endMs: range.endMs };
	}
	return range;
}
