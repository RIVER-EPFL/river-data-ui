/// The period a site holds visits in, so the Visits tab's timeline bar spans that and no more.

export interface VisitInstant {
	collected_at: string;
}

export interface Extent {
	min: number;
	max: number;
}

/// The first and last visit as epoch milliseconds. Null when the site holds none.
export function visitsExtent(visits: VisitInstant[]): Extent | null {
	const instants = visits.map((v) => Date.parse(v.collected_at)).filter((ms) => Number.isFinite(ms));
	if (instants.length === 0) return null;
	return { min: Math.min(...instants), max: Math.max(...instants) };
}

/// Whether a bar over this extent has anywhere to go: one visit, or several at one instant, has not.
export function isDraggableExtent(extent: Extent | null): boolean {
	return extent != null && extent.max > extent.min;
}

/// The period a site holds data in, from its first and last reading. Null when it holds none.
export function periodExtent(start: string | null | undefined, end: string | null | undefined): Extent | null {
	const min = start ? Date.parse(start) : NaN;
	const max = end ? Date.parse(end) : NaN;
	return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}

/// What the Visits tab's bar spans: the site's visits where they span a period, otherwise the
/// whole period the site holds data in. Null when neither has anywhere to drag.
export function barExtent(visits: Extent | null, site: Extent | null): Extent | null {
	if (isDraggableExtent(visits)) return visits;
	return isDraggableExtent(site) ? site : null;
}
