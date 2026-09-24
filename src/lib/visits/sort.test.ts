import { describe, expect, it } from 'vitest';

import type { VisitCell, VisitRow } from '$api/service';
import { DATE_SORT, nextSort, sortArrow, sortVisits } from './sort';

function visit(id: string, collectedAt: string, values: Record<string, number | undefined> = {}): VisitRow {
	return {
		id,
		collected_at: collectedAt,
		cells: Object.entries(values).map(
			([parameterId, value]) => ({ parameter_id: parameterId, value }) as unknown as VisitCell,
		),
		source: 'manual',
		recompute: 'current',
		parameters_filled: 0,
		findings_open: 0,
		unverified: false,
	};
}

const ids = (rows: VisitRow[]) => rows.map((v) => v.id);

const listed = [
	visit('v4', '2026-07-04T08:00:00Z', { ph: 7.2 }),
	visit('v3', '2026-07-03T08:00:00Z', {}),
	visit('v2', '2026-07-02T08:00:00Z', { ph: 6.8 }),
	visit('v1', '2026-07-01T08:00:00Z', { ph: 10 }),
];

describe('sorting the visits by a column', () => {
	it('keeps the listing order with no sort', () => {
		expect(sortVisits(listed, null)).toBe(listed);
	});

	it('orders numbers by value, not as text', () => {
		expect(ids(sortVisits(listed, { by: 'ph', direction: 'asc' }))).toEqual(['v2', 'v4', 'v1', 'v3']);
		expect(ids(sortVisits(listed, { by: 'ph', direction: 'desc' }))).toEqual(['v1', 'v4', 'v2', 'v3']);
	});

	it('puts empty cells last in both directions', () => {
		const asc = ids(sortVisits(listed, { by: 'do', direction: 'asc' }));
		expect(asc).toEqual(['v4', 'v3', 'v2', 'v1']);
		expect(ids(sortVisits(listed, { by: 'ph', direction: 'desc' })).at(-1)).toBe('v3');
	});

	it('sorts the date by collected_at', () => {
		expect(ids(sortVisits(listed, { by: DATE_SORT, direction: 'asc' }))).toEqual(['v1', 'v2', 'v3', 'v4']);
		expect(ids(sortVisits(listed, { by: DATE_SORT, direction: 'desc' }))).toEqual(['v4', 'v3', 'v2', 'v1']);
	});

	it('breaks ties newest first', () => {
		const tied = [
			visit('old', '2026-07-01T08:00:00Z', { ph: 7 }),
			visit('new', '2026-07-09T08:00:00Z', { ph: 7 }),
		];
		expect(ids(sortVisits(tied, { by: 'ph', direction: 'asc' }))).toEqual(['new', 'old']);
		expect(ids(sortVisits(tied, { by: 'ph', direction: 'desc' }))).toEqual(['new', 'old']);
	});
});

describe('a header click', () => {
	it('cycles ascending, descending, then the listing order', () => {
		const asc = nextSort(null, 'ph');
		expect(asc).toEqual({ by: 'ph', direction: 'asc' });
		const desc = nextSort(asc, 'ph');
		expect(desc).toEqual({ by: 'ph', direction: 'desc' });
		expect(nextSort(desc, 'ph')).toBeNull();
	});

	it('starts ascending on another column', () => {
		expect(nextSort({ by: 'ph', direction: 'desc' }, DATE_SORT)).toEqual({ by: DATE_SORT, direction: 'asc' });
	});

	it('shows an arrow only on the sorted column', () => {
		expect(sortArrow({ by: 'ph', direction: 'asc' }, 'ph')).toBe('▲');
		expect(sortArrow({ by: 'ph', direction: 'desc' }, 'ph')).toBe('▼');
		expect(sortArrow({ by: 'ph', direction: 'asc' }, 'do')).toBe('');
		expect(sortArrow(null, 'ph')).toBe('');
	});
});
