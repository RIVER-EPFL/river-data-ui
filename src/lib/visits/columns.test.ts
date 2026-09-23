import { describe, expect, it } from 'vitest';

import type { ExpectedParameter, VisitRow } from '$api/service';
import {
	CALCULATION_FILTER,
	askedWidth,
	calculationsOf,
	columnSpan,
	columnsInGroup,
	expandable,
	parameterColumns,
	replicateWidth,
	slotsOf,
	toggled,
} from './columns';

const expected: ExpectedParameter[] = [
	{ parameter_id: 'p-do', code: 'DO', name: 'Dissolved oxygen', units: 'mg/L' },
	{ parameter_id: 'p-temp', code: 'Temp', name: 'Temperature' },
];

function replicate(index: number, value: number) {
	return { replicate_index: index, value, flagged: false, withdrawn: false, unverified: false };
}

function visit(cells: { parameter_id: string; replicates: ReturnType<typeof replicate>[] }[]): VisitRow {
	return {
		id: `v-${cells.length}-${Math.random()}`,
		collected_at: '2026-06-01T08:00:00Z',
		source: 'manual',
		parameters_filled: cells.length,
		findings_open: 0,
		unverified: false,
		recompute: 'current',
		cells: cells.map((c) => ({
			parameter_id: c.parameter_id,
			flagged: false,
			withdrawn: false,
			n_total: c.replicates.length,
			n_flagged: 0,
			n_withdrawn: 0,
			n_unverified: 0,
			replicates: c.replicates,
		})),
	} as unknown as VisitRow;
}

const visits = [
	visit([
		{ parameter_id: 'p-do', replicates: [replicate(0, 10), replicate(1, 12)] },
		{ parameter_id: 'p-temp', replicates: [replicate(0, 4.2)] },
	]),
	visit([{ parameter_id: 'p-do', replicates: [replicate(0, 9), replicate(1, 9.5), replicate(2, 9.8)] }]),
];

describe('the visits table column groups', () => {
	it('is as wide as the widest listed visit, so a value stays under its own header', () => {
		expect(replicateWidth(visits, 'p-do')).toBe(3);
	});

	it('gives a parameter with no reading a column anyway', () => {
		expect(replicateWidth([], 'p-do')).toBe(1);
	});

	it('draws one column per parameter until one is expanded', () => {
		const columns = parameterColumns(expected, visits, new Set());
		expect(columns.map((c) => c.width)).toEqual([1, 1]);
		expect(columns.map((c) => c.repeats)).toEqual([3, 1]);
		expect(columnSpan(columns)).toBe(2);
	});

	it('opens the expanded parameter to its replicates and leaves its neighbours alone', () => {
		const columns = parameterColumns(expected, visits, new Set(['p-do']));
		expect(columns.map((c) => [c.code, c.width, c.repeats, c.expanded])).toEqual([
			['DO', 3, 3, true],
			['Temp', 1, 1, false],
		]);
		expect(columnSpan(columns)).toBe(4);
	});

	it('offers no expansion where every visit measured the parameter once', () => {
		expect(expandable(visits, 'p-temp')).toBe(false);
		expect(expandable(visits, 'p-do')).toBe(true);
	});

	it('toggles one parameter without disturbing the rest', () => {
		expect([...toggled(new Set(['p-temp']), 'p-do')]).toEqual(['p-temp', 'p-do']);
		expect([...toggled(new Set(['p-temp', 'p-do']), 'p-do')]).toEqual(['p-temp']);
	});
});

describe('the slots the keyboard walks', () => {
	it('gives a collapsed group one slot and an open one a slot per repeat', () => {
		const slots = slotsOf(parameterColumns(expected, visits, new Set(['p-do'])));
		expect(slots.map((s) => [s.parameterId, s.replicateIndex])).toEqual([
			['p-do', 0],
			['p-do', 1],
			['p-do', 2],
			['p-temp', 0],
		]);
	});

	it('walks a wholly collapsed table one slot per parameter', () => {
		const slots = slotsOf(parameterColumns(expected, visits, new Set()));
		expect(slots).toHaveLength(2);
		expect(slots.every((s) => s.replicateIndex === 0)).toBe(true);
	});
});

describe('widening a group by hand', () => {
	it('draws a column past what is stored only when the group was asked for one', () => {
		expect(replicateWidth(visits, 'p-do')).toBe(3);
		const asked = askedWidth(new Map(), visits, 'p-do', 4);
		expect(replicateWidth(visits, 'p-do', asked)).toBe(4);
	});

	it('will not narrow past the repeats the store holds', () => {
		const asked = askedWidth(new Map(), visits, 'p-do', 1);
		expect(replicateWidth(visits, 'p-do', asked)).toBe(3);
	});

	it('widens the asked-for group and no other', () => {
		const asked = askedWidth(new Map(), visits, 'p-do', 4);
		const columns = parameterColumns(expected, visits, new Set(['p-do', 'p-temp']), asked);
		expect(columns.map((c) => [c.code, c.width])).toEqual([
			['DO', 4],
			['Temp', 1],
		]);
	});
});

describe('narrowing the table to one parameter group', () => {
	const columns = parameterColumns(expected, visits, new Set());
	const groupOf = { 'p-do': 'g-carbon' };

	it('shows every column when no group is chosen', () => {
		expect(columnsInGroup(columns, groupOf, '')).toHaveLength(2);
	});

	it('shows the chosen group alone', () => {
		expect(columnsInGroup(columns, groupOf, 'g-carbon').map((c) => c.code)).toEqual(['DO']);
	});

	it('keeps a parameter belonging to nothing reachable', () => {
		expect(columnsInGroup(columns, groupOf, 'none').map((c) => c.code)).toEqual(['Temp']);
	});
});

describe('narrowing the table to one calculation', () => {
	const withCalculation: ExpectedParameter[] = [
		{ parameter_id: 'p-ffff', code: 'ffff', name: 'Output', written_by: 'evan' },
		{ parameter_id: 'p-co2', code: 'lab_co2_ch4', name: 'Lab CO2' },
		{ parameter_id: 'p-b', code: 'B', name: 'Input B', read_by: ['evan'] },
		{ parameter_id: 'p-a', code: 'A', name: 'Input A', read_by: ['evan', 'other'] },
	];
	const columns = parameterColumns(withCalculation, visits, new Set());
	const groupOf = { 'p-ffff': 'g-carbon', 'p-co2': 'g-carbon' };

	it('shows the inputs it reads, then the outputs it writes, whatever their group', () => {
		expect(
			columnsInGroup(columns, groupOf, `${CALCULATION_FILTER}evan`).map((c) => c.code),
		).toEqual(['B', 'A', 'ffff']);
	});

	it('lists each calculation the columns name once', () => {
		expect(calculationsOf(columns)).toEqual(['evan', 'other']);
	});
});
