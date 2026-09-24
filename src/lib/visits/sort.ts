import type { VisitRow } from '$api/service';
import { cellOf } from './tableEdit';

/** The column the visits are sorted by: `date`, or a parameter's id. */
export interface VisitSort {
	by: string;
	direction: 'asc' | 'desc';
}

export const DATE_SORT = 'date';

/** A header's next sort on a click: ascending, then descending, then the listing's own order. */
export function nextSort(current: VisitSort | null, by: string): VisitSort | null {
	if (current?.by !== by) return { by, direction: 'asc' };
	return current.direction === 'asc' ? { by, direction: 'desc' } : null;
}

function sortValue(visit: VisitRow, by: string): number | null {
	if (by === DATE_SORT) {
		const at = Date.parse(visit.collected_at);
		return Number.isNaN(at) ? null : at;
	}
	return cellOf(visit, by)?.value ?? null;
}

/**
 * The visits in the sort's order on the served value, empty cells last either way, ties newest
 * first. With no sort the listing's order stands.
 */
export function sortVisits(visits: VisitRow[], sort: VisitSort | null): VisitRow[] {
	if (!sort) return visits;
	const sign = sort.direction === 'asc' ? 1 : -1;
	const keyed = visits.map((visit) => ({
		visit,
		value: sortValue(visit, sort.by),
		at: Date.parse(visit.collected_at),
	}));
	keyed.sort((a, b) => {
		if (a.value === null || b.value === null) {
			if (a.value !== b.value) return a.value === null ? 1 : -1;
		} else if (a.value !== b.value) {
			return (a.value - b.value) * sign;
		}
		return b.at - a.at;
	});
	return keyed.map((k) => k.visit);
}

/** The arrow a header shows for the sort: none when it sorts by another column. */
export function sortArrow(sort: VisitSort | null, by: string): string {
	if (sort?.by !== by) return '';
	return sort.direction === 'asc' ? '▲' : '▼';
}
