import { describe, expect, it, vi } from 'vitest';

import type { VisitRow } from '$api/service';
import { parameterColumns, slotsOf, type GridSlot } from './columns';
import {
	FROZEN_COLUMNS,
	applyChanges,
	displayText,
	oncePerFrame,
	renderLive,
	pasteOverflow,
	sheetData,
	sheetHeaders,
	sheetSlot,
	storedValue,
	visitDates,
	type SheetTable,
} from './sheet';
import { gridRows, spareVisits, standingInstants } from './spareRows';

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

/** The table a listing draws: the visits it holds, with the one empty spare row under them. */
function table(rows: VisitRow[], slots: GridSlot[], spares = 1): SheetTable {
	const spare = spareVisits({}, spares, standingInstants(rows));
	return { rows: gridRows(rows, spare), stored: rows.length, slots };
}

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
		expect(sheetData(table(visits, slots), {}, {}, LOCALE, 'Europe/Zurich', always)[0][0]).toBe('2026-06-01 10:00:00');
		expect(sheetHeaders(columns, 'UTC')[1][0]).toBe('Date (UTC)');
		expect(sheetData(table(visits, slots), {}, {}, LOCALE, 'UTC', always)[0][0]).toBe('2026-06-01 08:00:00');
	});

	it('changes nothing but the date when the zone changes, so a staged value survives the switch', () => {
		const slots = slotsOf(parameterColumns(expected, visits, new Set()));
		const staged = { 'v2|p-temp|0': '5' };
		const utc = sheetData(table(visits, slots), staged, {}, LOCALE, 'UTC', always);
		const zurich = sheetData(table(visits, slots), staged, {}, LOCALE, 'Europe/Zurich', always);
		expect(zurich.map((row) => row.slice(1))).toEqual(utc.map((row) => row.slice(1)));
		expect(zurich[1][0]).not.toBe(utc[1][0]);
	});

	it('finds the visit and slot under a grid position, and nothing on the frozen columns', () => {
		const slots = slotsOf(parameterColumns(expected, visits, new Set(['p-do'])));
		const at = sheetSlot(table(visits, slots), 0, FROZEN_COLUMNS + 1)!;
		expect(at.visit.id).toBe('v1');
		expect(at.slot.parameterId).toBe('p-do');
		expect(at.slot.replicateIndex).toBe(1);
		expect(at.key).toBe('v1|p-do|1');
		expect(sheetSlot(table(visits, slots), 0, 0)).toBeNull();
	});

	it('names the spare row under the last visit, and one a paste runs further down onto', () => {
		const slots = slotsOf(parameterColumns(expected, visits, new Set()));
		const spare = sheetSlot(table(visits, slots), 2, FROZEN_COLUMNS)!;
		expect(spare.key).toBe('new:0|p-do|0');
		expect(spare.replicate).toBeNull();
		// A block pasted onto the spare row runs past the drawn rows and names the ones below it.
		expect(sheetSlot(table(visits, slots), 5, FROZEN_COLUMNS)!.key).toBe('new:3|p-do|0');
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
		const rows = sheetData(table(visits, slots), { 'v2|p-temp|0': '5' }, {}, LOCALE, 'UTC', always);
		expect(rows[0]).toEqual(['2026-06-01 08:00:00', '10', '12', '4.2']);
		// What was typed stands in for what the store holds.
		expect(rows[1]).toEqual(['2026-06-01 08:00:00', '9', '', '5']);
		// The spare row under them carries the date as typed, which is not an instant yet.
		expect(rows[2]).toEqual(['', '', '', '']);
		const staged = sheetData(table(visits, slots), {}, { 'new:0': '2026-07-02' }, LOCALE, 'UTC', always);
		expect(staged[2][0]).toBe('2026-07-02');
	});

	it('copies the instant at the precision it was recorded and pastes measurements into the visible columns', () => {
		const one = [{ ...visits[0], collected_at: '2025-08-26T10:30:45.123+02:00' }];
		const slots = slotsOf(parameterColumns(expected, one, new Set()));
		const row = sheetData(table(one, slots), {}, {}, LOCALE, 'UTC', always)[0];
		expect(row).toEqual(['2025-08-26 08:30:45.123', '10', '4.2']);
		const changes = row.map((raw, column) => ({ row: 1, column, raw }));
		const pasted = applyChanges(table(visits, slots), {}, {}, changes, LOCALE, true);
		expect(pasted.refused).toEqual([0]);
		expect(pasted.edits).toEqual({ 'v2|p-do|0': '10', 'v2|p-temp|0': '4.2' });
	});

	it('prints a cell at its slot declared precision, an undeclared one as measured', () => {
		const stored = 100.8000030517578;
		const one = [visit('v1', { 'p-do': [replicate(0, stored)], 'p-temp': [replicate(0, stored)] })];
		const slots = slotsOf(parameterColumns(expected, one, new Set()));
		const declared = sheetSlot(table(one, slots), 0, FROZEN_COLUMNS)!;
		const undeclared = sheetSlot(table(one, slots), 0, FROZEN_COLUMNS + 1)!;
		expect(displayText(declared, {}, true)).toBe('100.80');
		expect(displayText(undeclared, {}, true)).toBe('100.8');
		expect(displayText(declared, { 'v1|p-do|0': '101,5' }, true)).toBe('101,5');
	});

	it('takes a typed value, and a paste leaves a blank cell and an unreadable one alone', () => {
		const slots = slotsOf(parameterColumns(expected, visits, new Set(['p-do'])));
		const typed = applyChanges(table(visits, slots), {}, {}, [{ row: 0, column: FROZEN_COLUMNS, raw: '10.5' }], LOCALE, false);
		expect(typed.edits).toEqual({ 'v1|p-do|0': '10.5' });
		expect(typed.refused).toEqual([]);

		const pasted = applyChanges(
			table(visits, slots),
			{},
			{},
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
		// A listed visit's date takes nothing: its instant is what its readings are keyed on.
		expect(pasted.refused).toEqual([0, 1, 3]);
		expect(pasted.dates).toEqual({});
		expect(pasted.unreadable).toBe(1);
	});

	it('takes a date typed into the spare area, and the values pasted beside it', () => {
		const slots = slotsOf(parameterColumns(expected, visits, new Set()));
		const block = applyChanges(
			table(visits, slots),
			{},
			{},
			[
				{ row: 2, column: 0, raw: '2026-07-02' },
				{ row: 2, column: FROZEN_COLUMNS, raw: '8.5' },
				{ row: 3, column: 0, raw: '2026-07-03' },
				{ row: 3, column: FROZEN_COLUMNS, raw: '8.9' },
			],
			LOCALE,
			true,
		);
		expect(block.dates).toEqual({ 'new:0': '2026-07-02', 'new:1': '2026-07-03' });
		expect(block.edits).toEqual({ 'new:0|p-do|0': '8.5', 'new:1|p-do|0': '8.9' });
		expect(block.refused).toEqual([]);
	});

	it('drops a typed value that puts back what the store holds', () => {
		const slots = slotsOf(parameterColumns(expected, visits, new Set(['p-do'])));
		const undone = applyChanges(table(visits, slots), { 'v1|p-do|0': '10.5' }, {}, [{ row: 0, column: FROZEN_COLUMNS, raw: '10' }], LOCALE, false);
		expect(undone.edits).toEqual({});
	});

	it('counts the pasted values that run past the last column, not those past the last visit', () => {
		// Three columns, and a two-wide block starting on the last of them.
		const block = [
			['1', '2'],
			['3', ''],
		];
		expect(pasteOverflow(block, 2, 3)).toBe(1);
		expect(pasteOverflow(block, 0, 3)).toBe(0);
		expect(pasteOverflow([['1']], 0, 3)).toBe(0);
	});
});

describe('visitDates', () => {
	it('formats each stored visit once and leaves the spare rows out', () => {
		const rows = gridRows([visit('v1', {}), visit('v2', {})], spareVisits({}, 1, new Set()));
		let calls = 0;
		const dates = visitDates(rows, (at) => {
			calls += 1;
			return at.slice(0, 10);
		});
		expect(dates).toEqual({ v1: '2026-06-01', v2: '2026-06-01' });
		expect(calls).toBe(2);
	});

	it('is empty for no rows', () => {
		expect(visitDates([], () => 'x')).toEqual({});
	});
});

describe('oncePerFrame', () => {
	it('draws once for every request made inside one frame', () => {
		const frames: (() => void)[] = [];
		let draws = 0;
		const request = oncePerFrame(
			() => (draws += 1),
			(run) => frames.push(run),
		);
		for (let i = 0; i < 6; i += 1) request();
		expect(frames).toHaveLength(1);
		expect(draws).toBe(0);
		frames.shift()!();
		expect(draws).toBe(1);
		request();
		frames.shift()!();
		expect(draws).toBe(2);
	});
});

describe('renderLive', () => {
	it('draws a live grid', () => {
		const grid = { isDestroyed: false, render: vi.fn() };
		renderLive(grid);
		expect(grid.render).toHaveBeenCalledOnce();
	});

	it('draws nothing once the grid is destroyed or gone', () => {
		const grid = { isDestroyed: true, render: vi.fn() };
		renderLive(grid);
		renderLive(null);
		expect(grid.render).not.toHaveBeenCalled();
	});
});
