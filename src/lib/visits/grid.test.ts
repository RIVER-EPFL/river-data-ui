import { describe, expect, it } from 'vitest';

import type { EventCell, EventDetailResponse } from '$api/service';
import {
	addParameterRow,
	addableParameters,
	applyPaste,
	clearedCells,
	columnCount,
	gridFromVisit,
	pendingWrites,
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

	it('preselects the curve the stored replicates were corrected with', () => {
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

	it('grows replicate columns to fit the block and pads the rest', () => {
		const rows = applyPaste(base(), 0, 0, '120\t122\t118\t121');
		expect(columnCount(rows)).toBe(4);
		expect(rows[1].replicates).toHaveLength(4);
	});

	it('leaves a blank cell as a gap rather than shifting what follows', () => {
		const rows = applyPaste(base(), 0, 0, '120\t\t118');
		expect(rows[0].replicates.map((c) => c.value)).toEqual([120, null, 118]);
	});

	it('stops at the last row and keeps a computed row read-only', () => {
		const rows = gridFromVisit(
			visit([cell({ parameter_id: 'p-dom', parameter_code: 'DOM', written_by: 'dom' }), cell()]),
		);
		const pasted = applyPaste(rows, 0, 0, '5\n6\n7\n8');
		expect(pasted[0].replicates[0].value).toBeNull();
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
				standardCurveId: null,
			},
			{
				parameterId: 'p-doc',
				streamId: 'stream-doc',
				replicateIndex: 1,
				value: 130,
				corrects: false,
				standardCurveId: null,
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
				standardCurveId: null,
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

	it('adds an empty row as wide as the grid, and writes it as an entry', () => {
		let rows = gridFromVisit(visit([cell({ replicates: [stored(0, 120), stored(1, 118)] })]));
		rows = addParameterRow(rows, configured[1]);
		expect(rows).toHaveLength(2);
		expect(rows[1].parameterId).toBe('p-ph');
		expect(rows[1].replicates.map((c) => c.stored)).toEqual([null, null]);
		expect(addableParameters(rows, configured)).toEqual([]);

		rows = applyPaste(rows, 1, 0, '7.1\t7.3');
		expect(pendingWrites(rows)).toEqual([
			{
				parameterId: 'p-ph',
				streamId: '',
				replicateIndex: 0,
				value: 7.1,
				corrects: false,
				standardCurveId: null,
			},
			{
				parameterId: 'p-ph',
				streamId: '',
				replicateIndex: 1,
				value: 7.3,
				corrects: false,
				standardCurveId: null,
			},
		]);
	});
});

describe('the curve a row is read against', () => {
	it('travels with every value the row enters', () => {
		let rows = gridFromVisit(visit([cell({ replicates: [stored(0, 120)] })]));
		rows[0].standardCurveId = 'curve-4';
		rows = applyPaste(rows, 0, 0, '125\t130');
		expect(pendingWrites(rows).map((w) => w.standardCurveId)).toEqual(['curve-4', 'curve-4']);
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
