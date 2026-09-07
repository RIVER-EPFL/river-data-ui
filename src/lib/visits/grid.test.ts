import { describe, expect, it } from 'vitest';

import type { EventCell, EventDetailResponse } from '$api/service';
import {
	addParameterRow,
	addableParameters,
	applyPaste,
	clearedCells,
	columnCount,
	entryGroups,
	gridFromVisit,
	headerCount,
	isEditable,
	pendingWrites,
	setCellValue,
	stagedVisitFrom,
	touchedParameters,
	withColumns,
} from './grid';

function cell(over: Partial<EventCell> = {}): EventCell {
	return {
		parameter_id: 'p-doc',
		parameter_code: 'DOC_ppb',
		parameter_name: 'DOC',
		stream_id: 'stream-doc',
		origin: 'manual',
		has_provenance: false,
		replicates: [],
		...over,
	} as EventCell;
}

function visit(cells: EventCell[]): EventDetailResponse {
	return {
		id: 'event',
		site_id: 'site',
		collected_at: '2026-07-14T09:00:00Z',
		source: 'manual',
		recompute: 'current',
		cells,
	};
}

const stored = (index: number, value: number) => ({
	replicate_index: index,
	raw_value: value,
	flagged: false,
	withdrawn: false,
});

describe('the visit grid', () => {
	it('opens on what the visit stores, with a gap left where a repeat was not measured', () => {
		const rows = gridFromVisit(visit([cell({ replicates: [stored(0, 120), stored(2, 118)] })]));
		expect(rows).toHaveLength(1);
		expect(rows[0].replicates.map((c) => c.value)).toEqual([120, null, 118]);
		expect(rows[0].replicates.map((c) => c.stored)).toEqual([120, null, 118]);
		expect(columnCount(rows)).toBe(3);
	});

	it('keeps the record the detail already carries, so the cell needs no second fetch', () => {
		const record = { stream_id: 'stream-doc' } as unknown as NonNullable<EventCell['record']>;
		const rows = gridFromVisit(
			visit([
				cell({
					replicates: [stored(0, 120)],
					record,
					has_provenance: true,
					provenance_kind: 'tool_run',
					tool: 'doc',
					origin: 'manual',
					source_system: 'grab_sample',
					source_key: 'site:p-doc',
					finding: { id: 'f1', kind: 'stale_output', status: 'pending' },
				}),
			]),
		);
		expect(rows[0].record).toBe(record);
		expect(rows[0].hasProvenance).toBe(true);
		expect(rows[0].provenanceKind).toBe('tool_run');
		expect(rows[0].tool).toBe('doc');
		expect(rows[0].origin).toBe('manual');
		expect(rows[0].sourceSystem).toBe('grab_sample');
		expect(rows[0].sourceKey).toBe('site:p-doc');
		expect(rows[0].finding).toBe('stale_output');
	});

	it('gives a parameter added by hand no record, because nothing has been stored for it', () => {
		const rows = addParameterRow(gridFromVisit(visit([cell({ replicates: [stored(0, 1)] })])), {
			parameterId: 'p-tdn',
			code: 'TDN_ppb',
			name: 'TDN',
		});
		expect(rows[1].record).toBeUndefined();
		expect(rows[1].hasProvenance).toBe(false);
	});

	it('draws a rectangle: a narrower row is padded, never a ragged grid', () => {
		const rows = gridFromVisit(
			visit([
				cell({ replicates: [stored(0, 1), stored(1, 2), stored(2, 3)] }),
				cell({ parameter_id: 'p-ph', parameter_code: 'pH', replicates: [stored(0, 7)] }),
			]),
		);
		const wide = withColumns(rows, columnCount(rows));
		expect(wide.every((r) => r.replicates.length === 3)).toBe(true);
		expect(wide[1].replicates.map((c) => c.value)).toEqual([7, null, null]);
	});

	it('carries the role and the calculation that owns the parameter', () => {
		const rows = gridFromVisit(
			visit([
				cell({ read_by: ['doc'] }),
				cell({ parameter_id: 'p-dom', parameter_code: 'DOM', written_by: 'dom' }),
			]),
		);
		expect(rows[0].role).toBe('input');
		expect(rows[0].roleTitle).toContain('doc');
		expect(rows[1].role).toBe('output');
		expect(rows[1].writtenBy).toBe('dom');
	});

	it('reads back the curve the stored replicates were corrected with', () => {
		const rows = gridFromVisit(
			visit([
				cell({
					replicates: [
						{ ...stored(0, 120), standard_curve_id: 'curve-1' },
						{ ...stored(1, 122), standard_curve_id: 'curve-1' },
					],
				}),
			]),
		);
		expect(rows[0].standardCurveId).toBe('curve-1');
	});
});

describe('pasting a spreadsheet block', () => {
	const base = () =>
		gridFromVisit(
			visit([
				cell({ replicates: [stored(0, 1)] }),
				cell({ parameter_id: 'p-ph', parameter_code: 'pH', replicates: [stored(0, 7)] }),
			]),
		);

	it('fills rightward and downward from the focused cell', () => {
		const rows = applyPaste(base(), 0, 0, '120\t122\t118\n7.1\t7.2\t7.3');
		expect(rows[0].replicates.map((c) => c.value)).toEqual([120, 122, 118]);
		expect(rows[1].replicates.map((c) => c.value)).toEqual([7.1, 7.2, 7.3]);
	});

	it('grows only the rows the block covers, and each to its own line', () => {
		const rows = applyPaste(base(), 0, 0, '120\t122\t118\t121');
		expect(columnCount(rows)).toBe(4);
		expect(rows[0].replicates).toHaveLength(4);
		expect(rows[1].replicates).toHaveLength(1);
	});

	it('leaves a blank cell as a gap rather than shifting what follows', () => {
		const rows = applyPaste(base(), 0, 0, '120\t\t118');
		expect(rows[0].replicates.map((c) => c.value)).toEqual([120, null, 118]);
	});

	it('stops at the last row and keeps a computed row read-only', () => {
		const rows = gridFromVisit(
			visit([
				cell({ parameter_id: 'p-dom', parameter_code: 'DOM', written_by: 'dom' }),
				cell({ replicates: [stored(0, 1)] }),
			]),
		);
		const pasted = applyPaste(rows, 0, 0, '5\n6\n7\n8');
		expect(pasted[0].replicates).toEqual([]);
		expect(pasted[1].replicates[0].value).toBe(6);
	});

	it('ignores a cell that is not a number rather than writing NaN', () => {
		const rows = applyPaste(base(), 0, 0, 'n/a');
		expect(rows[0].replicates[0].value).toBe(1);
	});

	it('accepts the line endings a spreadsheet pastes', () => {
		const rows = applyPaste(base(), 0, 0, '120\r\n7.5\r\n');
		expect(rows[0].replicates[0].value).toBe(120);
		expect(rows[1].replicates[0].value).toBe(7.5);
	});
});

describe('what a save would write', () => {
	it('is only the cells that moved, and says which are corrections', () => {
		let rows = gridFromVisit(visit([cell({ replicates: [stored(0, 120)] })]));
		expect(pendingWrites(rows)).toEqual([]);
		rows = applyPaste(rows, 0, 0, '125\t130');
		expect(pendingWrites(rows)).toEqual([
			{
				parameterId: 'p-doc',
				streamId: 'stream-doc',
				replicateIndex: 0,
				value: 125,
				corrects: true,
				sensorId: null,
			},
			{
				parameterId: 'p-doc',
				streamId: 'stream-doc',
				replicateIndex: 1,
				value: 130,
				corrects: false,
				sensorId: null,
			},
		]);
		expect(touchedParameters(rows)).toEqual(['p-doc']);
	});

	it('never writes a computed row', () => {
		const rows = applyPaste(
			gridFromVisit(visit([cell({ parameter_id: 'p-dom', written_by: 'dom' })])),
			0,
			0,
			'42',
		);
		expect(pendingWrites(rows)).toEqual([]);
	});

	it('names a cleared cell rather than treating the clear as a write', () => {
		const rows = gridFromVisit(visit([cell({ replicates: [stored(0, 120)] })]));
		rows[0].replicates[0].value = null;
		expect(pendingWrites(rows)).toEqual([]);
		expect(clearedCells(rows)).toEqual([
			{
				parameterId: 'p-doc',
				streamId: 'stream-doc',
				replicateIndex: 0,
				value: 120,
				corrects: true,
				sensorId: null,
			},
		]);
	});
});

describe('entering a parameter the visit does not hold yet', () => {
	const configured = [
		{ parameterId: 'p-doc', code: 'DOC_ppb', name: 'DOC' },
		{ parameterId: 'p-ph', code: 'pH', name: 'pH' },
	];

	it('offers only what is not already a row', () => {
		const rows = gridFromVisit(visit([cell({ replicates: [stored(0, 120)] })]));
		expect(addableParameters(rows, configured)).toEqual([
			{ parameterId: 'p-ph', code: 'pH', name: 'pH' },
		]);
	});

	it('adds a row of no replicates, and writes what is typed into it as an entry', () => {
		let rows = gridFromVisit(visit([cell({ replicates: [stored(0, 120), stored(1, 118)] })]));
		rows = addParameterRow(rows, configured[1]);
		expect(rows).toHaveLength(2);
		expect(rows[1].parameterId).toBe('p-ph');
		expect(rows[1].replicates).toEqual([]);
		expect(addableParameters(rows, configured)).toEqual([]);

		rows = applyPaste(rows, 1, 0, '7.1\t7.3');
		expect(pendingWrites(rows)).toEqual([
			{
				parameterId: 'p-ph',
				streamId: '',
				replicateIndex: 0,
				value: 7.1,
				corrects: false,
				sensorId: null,
			},
			{
				parameterId: 'p-ph',
				streamId: '',
				replicateIndex: 1,
				value: 7.3,
				corrects: false,
				sensorId: null,
			},
		]);
	});
});

describe('the curve a row is read against', () => {
	// Q97: a curve is chosen in the tool that computes with it. The grid shows which one corrected
	// the stored values and never sends one, so a value entered here is raw.
	it('is shown but never written by the grid', () => {
		let rows = gridFromVisit(visit([cell({ replicates: [stored(0, 120)] })]));
		rows[0].standardCurveId = 'curve-4';
		rows = applyPaste(rows, 0, 0, '125\t130');
		expect(rows[0].standardCurveId).toBe('curve-4');
		expect(pendingWrites(rows)).toHaveLength(2);
		for (const write of pendingWrites(rows)) {
			expect(write).not.toHaveProperty('standardCurveId');
		}
	});
});

describe('opening a computed row in its tool', () => {
	it('stages the visit being read, not the one last staged', () => {
		expect(stagedVisitFrom(visit([]), 'FP1')).toEqual({
			eventId: 'event',
			siteId: 'site',
			siteName: 'FP1',
			collectedAt: '2026-07-14T09:00:00Z',
		});
	});
});

describe('entryGroups', () => {
	// `mode: replace` rewrites every group the request names, so a save carrying only the cell the
	// operator typed would delete the replicates already stored beside it.
	const typed = (rows: ReturnType<typeof gridFromVisit>, column: number, value: number) => {
		const next = rows.map((r) => ({ ...r, replicates: r.replicates.map((c) => ({ ...c })) }));
		next[0].replicates[column].value = value;
		return next;
	};

	it('carries the whole group when one replicate is entered beside stored ones', () => {
		const rows = withColumns(
			gridFromVisit(visit([cell({ replicates: [stored(0, 120), stored(1, 122)] })])),
			3,
		);
		expect(entryGroups(typed(rows, 2, 118)).map((w) => [w.replicateIndex, w.value])).toEqual([
			[0, 120],
			[1, 122],
			[2, 118],
		]);
	});

	it('leaves a row alone when every change on it is a correction', () => {
		const rows = gridFromVisit(visit([cell({ replicates: [stored(0, 120)] })]));
		expect(entryGroups(typed(rows, 0, 121))).toEqual([]);
	});

	it('carries no cell of a row a calculation writes', () => {
		const rows = withColumns(
			gridFromVisit(visit([cell({ written_by: 'doc', replicates: [stored(0, 120)] })])),
			2,
		);
		expect(entryGroups(typed(rows, 1, 118))).toEqual([]);
	});

	it('does not carry a gap, so a repeat nobody measured stays unwritten', () => {
		const rows = withColumns(gridFromVisit(visit([cell({ replicates: [stored(0, 120)] })])), 3);
		expect(entryGroups(typed(rows, 2, 118)).map((w) => w.replicateIndex)).toEqual([0, 2]);
	});
});

describe('a row is as wide as the repeats it holds', () => {
	const grid = () =>
		gridFromVisit(
			visit([
				cell({ replicates: [stored(0, 120), stored(1, 122), stored(2, 118)] }),
				cell({ parameter_id: 'p-ph', parameter_code: 'pH', replicates: [stored(0, 7.1)] }),
			]),
		);

	it('draws one column past the widest row, so every row has a cell to add a repeat in', () => {
		expect(columnCount(grid())).toBe(3);
		expect(headerCount(grid())).toBe(4);
	});

	it('offers an input on a row\'s own replicates and one past them, and nowhere else', () => {
		const rows = grid();
		expect([0, 1, 2, 3].map((c) => isEditable(rows[1], c))).toEqual([true, true, false, false]);
		expect([0, 1, 2, 3].map((c) => isEditable(rows[0], c))).toEqual([true, true, true, true]);
	});

	it('never offers an input on a row a calculation writes', () => {
		const [computed] = gridFromVisit(visit([cell({ written_by: 'doc' })]));
		expect(isEditable(computed, 0)).toBe(false);
	});

	it('grows one row alone when its trailing cell is typed into', () => {
		const rows = setCellValue(grid(), 1, 1, 7.4);
		expect(rows[1].replicates.map((c) => c.value)).toEqual([7.1, 7.4]);
		expect(rows[0].replicates).toHaveLength(3);
	});

	it('gives back the width when the added value is cleared again', () => {
		const typed = setCellValue(grid(), 1, 1, 7.4);
		expect(setCellValue(typed, 1, 1, null)[1].replicates).toHaveLength(1);
	});

	it('keeps a gap between two measured repeats, because the index is a position', () => {
		const rows = setCellValue(grid(), 1, 2, 7.9);
		expect(rows[1].replicates.map((c) => c.value)).toEqual([7.1, null, 7.9]);
	});

	it('does not shorten a row past what the store holds', () => {
		const rows = setCellValue(grid(), 0, 2, null);
		expect(rows[0].replicates.map((c) => c.value)).toEqual([120, 122, null]);
	});
});

describe('the instrument a row was measured with', () => {
	it('is read from the stored replicates and travels with every value the row enters', () => {
		let rows = gridFromVisit(
			visit([cell({ replicates: [{ ...stored(0, 120), sensor_id: 'probe-1' }] })]),
		);
		expect(rows[0].sensorId).toBe('probe-1');
		rows = applyPaste(rows, 0, 0, '125\t130');
		expect(pendingWrites(rows).map((w) => w.sensorId)).toEqual(['probe-1', 'probe-1']);
	});

	it('is null where the row declares none', () => {
		const rows = gridFromVisit(visit([cell({ replicates: [stored(0, 120)] })]));
		rows[0].replicates[0].value = 121;
		expect(pendingWrites(rows).map((w) => w.sensorId)).toEqual([null]);
	});
});
