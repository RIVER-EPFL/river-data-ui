import { describe, expect, it } from 'vitest';

import type { VisitRow } from '$api/service';
import { parameterColumns, slotsOf } from './columns';
import {
	FROZEN_COLUMNS,
	applyChanges,
	displayText,
	pasteOverflow,
	sheetData,
	sheetHeaders,
	sheetSlot,
	storedValue,
} from './sheet';

const LOCALE = 'en-GB';

function replicate(index: number, value: number, streamId = 'stream-do') {
	return {
		replicate_index: index,
		value,
		stream_id: streamId,
		flagged: false,
		withdrawn: false,
		unverified: false,
	};
}

function visit(
	id: string,
	cells: Record<string, ReturnType<typeof replicate>[]>,
	served: Record<string, number | null> = {},
): VisitRow {
	return {
		id,
		collected_at: '2026-06-01T08:00:00Z',
		source: 'manual',
		created_by: 'tester',
		parameters_filled: Object.keys(cells).length,
		findings_open: 0,
		unverified: false,
		recompute: 'current',
		cells: Object.entries(cells).map(([parameter_id, replicates]) => ({
			parameter_id,
			value:
				parameter_id in served
					? served[parameter_id]
					: replicates.reduce((s, r) => s + r.value, 0) / replicates.length,
			n: replicates.length,
			flagged: false,
			withdrawn: false,
			n_total: replicates.length,
			n_flagged: 0,
			n_withdrawn: 0,
			n_unverified: 0,
			has_provenance: false,
			replicates,
		})),
	} as unknown as VisitRow;
}

const expected = [
	{ parameter_id: 'p-do', code: 'DO', name: 'DO', units: 'mg/L', decimal_places: 2 },
	{ parameter_id: 'p-temp', code: 'TEMP', name: 'Temp', units: null, decimal_places: null },
] as never;

const visits = [
	visit('v1', { 'p-do': [replicate(0, 10), replicate(1, 12)], 'p-temp': [replicate(0, 4.2, 'stream-temp')] }),
	visit('v2', { 'p-do': [replicate(0, 9)] }),
];

const always = () => true;

describe('the visits sheet', () => {
	it('heads each group with its code across its repeats, and numbers the repeats of an open one', () => {
		const collapsed = parameterColumns(expected, visits, new Set());
		expect(sheetHeaders(collapsed, 'UTC')).toEqual([
			['', { label: 'DO (mg/L)', colspan: 1 }, { label: 'TEMP', colspan: 1 }],
			['Date (UTC)', '', ''],
		]);
		const open = parameterColumns(expected, visits, new Set(['p-do']));
		expect(sheetHeaders(open, 'UTC')[0][1]).toEqual({ label: 'DO (mg/L)', colspan: 2 });
		expect(sheetHeaders(open, 'UTC')[1].slice(FROZEN_COLUMNS)).toEqual(['1', '2', '']);
	});

	it('prints the visit date in the zone the header names', () => {
		const columns = parameterColumns(expected, visits, new Set());
		const slots = slotsOf(columns);
		// 08:00 UTC on 1 June is 10:00 that day in Zurich.
		expect(sheetHeaders(columns, 'Europe/Zurich')[1][0]).toBe('Date (Europe/Zurich)');
		expect(sheetData(visits, slots, {}, LOCALE, 'Europe/Zurich', always)[0][0]).toBe('2026-06-01 10:00:00');
		expect(sheetHeaders(columns, 'UTC')[1][0]).toBe('Date (UTC)');
		expect(sheetData(visits, slots, {}, LOCALE, 'UTC', always)[0][0]).toBe('2026-06-01 08:00:00');
	});

	it('changes nothing but the date when the zone changes, so a staged value survives the switch', () => {
		const slots = slotsOf(parameterColumns(expected, visits, new Set()));
		const staged = { 'v2|p-temp|0': '5' };
		const utc = sheetData(visits, slots, staged, LOCALE, 'UTC', always);
		const zurich = sheetData(visits, slots, staged, LOCALE, 'Europe/Zurich', always);
		expect(zurich.map((row) => row.slice(1))).toEqual(utc.map((row) => row.slice(1)));
		expect(zurich[1][0]).not.toBe(utc[1][0]);
	});

	it('finds the visit and slot under a grid position, and nothing on the frozen columns', () => {
		const slots = slotsOf(parameterColumns(expected, visits, new Set(['p-do'])));
		expect(sheetSlot(visits, slots, 0, 0)).toBeNull();
		const at = sheetSlot(visits, slots, 0, FROZEN_COLUMNS + 1)!;
		expect(at.visit.id).toBe('v1');
		expect(at.slot.parameterId).toBe('p-do');
		expect(at.slot.replicateIndex).toBe(1);
		expect(at.key).toBe('v1|p-do|1');
		expect(sheetSlot(visits, slots, 2, FROZEN_COLUMNS)).toBeNull();
	});

	it('shows a collapsed group of repeats at its served value, and a writable slot at its replicate', () => {
		const collapsed = slotsOf(parameterColumns(expected, visits, new Set()));
		// 10 and 12 collapse to the mean the server serves.
		expect(storedValue(visits[0], collapsed[0], false)).toBe(11);
		const flagged = visit('v3', { 'p-temp': [replicate(0, 4.2)] }, { 'p-temp': null });
		// A single reading the server serves nothing for still holds a value to correct.
		expect(storedValue(flagged, collapsed[1], true)).toBe(4.2);
		expect(storedValue(flagged, collapsed[1], false)).toBeNull();
	});

	it('lays the rows out as the text a copy carries: every stored value at full precision', () => {
		const slots = slotsOf(parameterColumns(expected, visits, new Set(['p-do'])));
		const rows = sheetData(visits, slots, { 'v2|p-temp|0': '5' }, LOCALE, 'UTC', always);
		expect(rows[0]).toEqual(['2026-06-01 08:00:00', '10', '12', '4.2']);
		// What was typed stands in for what the store holds.
		expect(rows[1]).toEqual(['2026-06-01 08:00:00', '9', '', '5']);
	});

	it('copies the instant at the precision it was recorded and pastes measurements into the visible columns', () => {
		const one = [{ ...visits[0], collected_at: '2025-08-26T10:30:45.123+02:00' }];
		const slots = slotsOf(parameterColumns(expected, one, new Set()));
		const row = sheetData(one, slots, {}, LOCALE, 'UTC', always)[0];
		expect(row).toEqual(['2025-08-26 08:30:45.123', '10', '4.2']);
		const changes = row.map((raw, column) => ({ row: 1, column, raw }));
		const pasted = applyChanges({}, visits, slots, changes, LOCALE, true);
		expect(pasted.refused).toEqual([0]);
		expect(pasted.edits).toEqual({ 'v2|p-do|0': '10', 'v2|p-temp|0': '4.2' });
	});

	it('prints a cell at its slot declared precision, an undeclared one as measured', () => {
		const stored = 100.8000030517578;
		const one = [visit('v1', { 'p-do': [replicate(0, stored)], 'p-temp': [replicate(0, stored)] })];
		const slots = slotsOf(parameterColumns(expected, one, new Set()));
		const declared = sheetSlot(one, slots, 0, FROZEN_COLUMNS)!;
		const undeclared = sheetSlot(one, slots, 0, FROZEN_COLUMNS + 1)!;
		expect(displayText(declared, {}, true)).toBe('100.80');
		expect(displayText(undeclared, {}, true)).toBe('100.8');
		expect(displayText(declared, { 'v1|p-do|0': '101,5' }, true)).toBe('101,5');
	});

	it('takes a typed value, and a paste leaves a blank cell and an unreadable one alone', () => {
		const slots = slotsOf(parameterColumns(expected, visits, new Set(['p-do'])));
		const typed = applyChanges({}, visits, slots, [{ row: 0, column: FROZEN_COLUMNS, raw: '10.5' }], LOCALE, false);
		expect(typed.edits).toEqual({ 'v1|p-do|0': '10.5' });
		expect(typed.refused).toEqual([]);

		const pasted = applyChanges(
			{},
			visits,
			slots,
			[
				{ row: 0, column: FROZEN_COLUMNS, raw: '' },
				{ row: 0, column: FROZEN_COLUMNS + 1, raw: 'n/a' },
				{ row: 1, column: FROZEN_COLUMNS + 2, raw: '6.1' },
				{ row: 1, column: 0, raw: '2026-01-01' },
			],
			LOCALE,
			true,
		);
		expect(pasted.edits).toEqual({ 'v2|p-temp|0': '6.1' });
		expect(pasted.refused).toEqual([0, 1, 3]);
		expect(pasted.unreadable).toBe(1);
	});

	it('drops a typed value that puts back what the store holds', () => {
		const slots = slotsOf(parameterColumns(expected, visits, new Set(['p-do'])));
		const undone = applyChanges({ 'v1|p-do|0': '10.5' }, visits, slots, [{ row: 0, column: FROZEN_COLUMNS, raw: '10' }], LOCALE, false);
		expect(undone.edits).toEqual({});
	});

	it('counts the pasted values that run past the last visit or the last column', () => {
		// Two visits and three columns; the block starts on the second visit's last column.
		const block = [
			['1', '2'],
			['3', ''],
		];
		expect(pasteOverflow(block, 1, 2, 2, 3)).toBe(2);
		expect(pasteOverflow([['1']], 0, 0, 2, 3)).toBe(0);
	});
});
