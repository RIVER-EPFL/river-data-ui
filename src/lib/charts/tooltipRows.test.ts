import { describe, expect, it } from 'vitest';

import { TOOLTIP_ROW_LIMIT, capRows } from './tooltipRows';

const series = (id: number, detailed = false) => ({ id, detailed });

describe('the shared tooltip row cap', () => {
	it('leaves a list under the limit alone', () => {
		const rows = [series(0), series(1, true), series(2)];
		expect(capRows(rows, 12)).toEqual({ shown: rows, hidden: 0 });
	});

	// VAD on dev: 90 parameters, so 90 charts registered with the cursor group.
	it('caps a ninety-chart site and counts what it left out', () => {
		const rows = Array.from({ length: 90 }, (_, i) => series(i, i === 0));
		const { shown, hidden } = capRows(rows, TOOLTIP_ROW_LIMIT);
		expect(shown).toHaveLength(TOOLTIP_ROW_LIMIT);
		expect(hidden).toBe(90 - TOOLTIP_ROW_LIMIT);
	});

	it('keeps the chart under the cursor however far down it registered', () => {
		const rows = Array.from({ length: 90 }, (_, i) => series(i, i === 74));
		const { shown, hidden } = capRows(rows, 5);
		expect(shown.map((r) => r.id)).toEqual([0, 1, 2, 3, 74]);
		expect(hidden).toBe(85);
		expect(shown.filter((r) => r.detailed)).toHaveLength(1);
	});

	it('states a total that accounts for every row', () => {
		const rows = Array.from({ length: 40 }, (_, i) => series(i, i === 39));
		const { shown, hidden } = capRows(rows, 12);
		expect(shown.length + hidden).toBe(40);
	});

	it('caps a group with no chart under the cursor', () => {
		const rows = Array.from({ length: 20 }, (_, i) => series(i));
		const { shown, hidden } = capRows(rows, 3);
		expect(shown.map((r) => r.id)).toEqual([0, 1, 2]);
		expect(hidden).toBe(17);
	});
});
