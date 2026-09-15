import { describe, expect, it } from 'vitest';

import type { EventCell, EventDetailResponse } from '$api/service';
import {
	addParameterRow,
	applyPaste,
	cellStateTitle,
	unreadablePasteNotice,
	clearedCells,
	copyBlock,
	columnCount,
	entryGroups,
	expectedReplicates,
	gridFromVisit,
	headerCount,
	isEditable,
	rendersInput,
	pendingWrites,
	refusalMessage,
	saveErrors,
	rowsInGroup,
	seedReplicateCounts,
	setCellValue,
	setReplicateCount,
	stagedVisitFrom,
	touchedParameters,
	withColumns,
	withConfiguredRows,
	duplicatedParameters,
	rowKey,
	rowStats,
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
		unverified: false,
		recompute: 'current',
		cells,
	};
}

const stored = (index: number, value: number) => ({
	replicate_index: index,
	raw_value: value,
	flagged: false,
	withdrawn: false,
	unverified: false,
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
		const rows = applyPaste(base(), 0, 0, '120\t122\t118\n7.1\t7.2\t7.3', 'en-US').rows;
		expect(rows[0].replicates.map((c) => c.value)).toEqual([120, 122, 118]);
		expect(rows[1].replicates.map((c) => c.value)).toEqual([7.1, 7.2, 7.3]);
	});

	it('grows only the rows the block covers, and each to its own line', () => {
		const rows = applyPaste(base(), 0, 0, '120\t122\t118\t121', 'en-US').rows;
		expect(columnCount(rows)).toBe(4);
		expect(rows[0].replicates).toHaveLength(4);
		expect(rows[1].replicates).toHaveLength(1);
	});

	it('leaves a blank cell as a gap rather than shifting what follows', () => {
		const rows = applyPaste(base(), 0, 0, '120\t\t118', 'en-US').rows;
		expect(rows[0].replicates.map((c) => c.value)).toEqual([120, null, 118]);
	});

	it('stops at the last row and keeps a computed row read-only', () => {
		const rows = gridFromVisit(
			visit([
				cell({ parameter_id: 'p-dom', parameter_code: 'DOM', written_by: 'dom' }),
				cell({ replicates: [stored(0, 1)] }),
			]),
		);
		const pasted = applyPaste(rows, 0, 0, '5\n6\n7\n8', 'en-US').rows;
		expect(pasted[0].replicates).toEqual([]);
		expect(pasted[1].replicates[0].value).toBe(6);
	});

	it('starts where the paste was made, not at the first cell of the row', () => {
		const rows = applyPaste(base(), 0, 2, '120\t122', 'en-US').rows;
		expect(rows[0].replicates.map((c) => c.value)).toEqual([1, null, 120, 122]);
	});

	it('starts at the row the paste was made on, leaving the rows above it alone', () => {
		const rows = applyPaste(base(), 1, 0, '7.4\t7.5', 'en-US').rows;
		expect(rows[0].replicates.map((c) => c.value)).toEqual([1]);
		expect(rows[1].replicates.map((c) => c.value)).toEqual([7.4, 7.5]);
	});

	it('ignores a cell that is not a number rather than writing NaN', () => {
		const rows = applyPaste(base(), 0, 0, 'n/a', 'en-US').rows;
		expect(rows[0].replicates[0].value).toBe(1);
	});

	// A cell the locale cannot read leaves the row as it stands, and the row it lands on may
	// already hold the last visit's values: silence there is a stale value saved as this visit's.
	it('counts the cells it could not read, so the paste does not look like it worked', () => {
		const pasted = applyPaste(base(), 0, 0, '12,5\t13,1\t12,8', 'en-US');
		expect(pasted.unreadable).toBe(3);
		expect(pasted.rows[0].replicates.map((c) => c.value)).toEqual([1]);
	});

	// The lab's own machines are fr-CH, where Excel writes 12,5 and 1'026.
	it('reads a sheet written in the locale of the machine pasting it', () => {
		const pasted = applyPaste(base(), 0, 0, '12,5\t13,1\t12,8', 'fr-CH');
		expect(pasted.unreadable).toBe(0);
		expect(pasted.rows[0].replicates.map((c) => c.value)).toEqual([12.5, 13.1, 12.8]);

		const grouped = applyPaste(base(), 0, 0, "1'026\t1'030", 'de-CH');
		expect(grouped.unreadable).toBe(0);
		expect(grouped.rows[0].replicates.map((c) => c.value)).toEqual([1026, 1030]);
	});

	it('counts nothing when every cell is a number or a deliberate gap', () => {
		expect(applyPaste(base(), 0, 0, '120\t\t118', 'en-US').unreadable).toBe(0);
	});

	it('says nothing about a paste that was read in full', () => {
		expect(unreadablePasteNotice(0)).toBeNull();
		expect(unreadablePasteNotice(1)).toContain('1 pasted cell was not a number');
		expect(unreadablePasteNotice(4)).toContain('4 pasted cells were not numbers');
	});

	it('accepts the line endings a spreadsheet pastes', () => {
		const rows = applyPaste(base(), 0, 0, '120\r\n7.5\r\n', 'en-US').rows;
		expect(rows[0].replicates[0].value).toBe(120);
		expect(rows[1].replicates[0].value).toBe(7.5);
	});
});

describe('copying a selection out of the grid', () => {
	const base = () =>
		gridFromVisit(
			visit([
				cell({ replicates: [stored(0, 120), stored(1, 122), stored(2, 118)] }),
				cell({
					parameter_id: 'p-ph',
					parameter_code: 'pH',
					replicates: [stored(0, 7.1), stored(1, 7.2)],
				}),
			]),
		);

	it('is the block as tab-separated lines, in the layout a paste reads', () => {
		expect(copyBlock(base(), 0, 0, 2, 3)).toBe('120\t122\t118\n7.1\t7.2\t');
	});

	it('takes the block the selection covers, not the whole row', () => {
		expect(copyBlock(base(), 0, 1, 1, 2)).toBe('122\t118');
	});

	it('writes a repeat that was not measured as an empty cell', () => {
		const rows = applyPaste(base(), 0, 0, '120\t\t118', 'en-US').rows;
		expect(copyBlock(rows, 0, 0, 1, 3)).toBe('120\t\t118');
	});

	it('copies what a computed row shows, which a paste back onto it will not write', () => {
		const rows = gridFromVisit(
			visit([cell({ parameter_id: 'p-dom', parameter_code: 'DOM', written_by: 'dom', replicates: [stored(0, 4.2)] })]),
		);
		expect(copyBlock(rows, 0, 0, 1, 1)).toBe('4.2');
	});

	it('round trips: the block pasted back where it was copied from changes nothing', () => {
		const rows = base();
		const pasted = applyPaste(rows, 0, 0, copyBlock(rows, 0, 0, 2, 3), 'en-US').rows;
		expect(pasted.map((r) => r.replicates.map((c) => c.value))).toEqual(
			rows.map((r) => r.replicates.map((c) => c.value)),
		);
	});
});

describe('what a save would write', () => {
	it('is only the cells that moved, and says which are corrections', () => {
		let rows = gridFromVisit(visit([cell({ replicates: [stored(0, 120)] })]));
		expect(pendingWrites(rows)).toEqual([]);
		rows = applyPaste(rows, 0, 0, '125\t130', 'en-US').rows;
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
			'en-US',
		).rows;
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

	it('adds a row of no replicates, and writes what is typed into it as an entry', () => {
		let rows = gridFromVisit(visit([cell({ replicates: [stored(0, 120), stored(1, 118)] })]));
		rows = addParameterRow(rows, configured[1]);
		expect(rows).toHaveLength(2);
		expect(rows[1].parameterId).toBe('p-ph');
		expect(rows[1].replicates).toEqual([]);

		rows = applyPaste(rows, 1, 0, '7.1\t7.3', 'en-US').rows;
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
		rows = applyPaste(rows, 0, 0, '125\t130', 'en-US').rows;
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

	it('draws no input where an intern would be overwriting a stored value', () => {
		const rows = grid();
		expect(rendersInput(rows[1], 0, 2)).toBe(true);
		expect(rendersInput(rows[1], 0, 1)).toBe(false);
		expect(rendersInput(rows[1], 1, 1)).toBe(true);
		expect(rendersInput(rows[1], 2, 2)).toBe(false);
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
		rows = applyPaste(rows, 0, 0, '125\t130', 'en-US').rows;
		expect(pendingWrites(rows).map((w) => w.sensorId)).toEqual(['probe-1', 'probe-1']);
	});

	it('is null where the row declares none', () => {
		const rows = gridFromVisit(visit([cell({ replicates: [stored(0, 120)] })]));
		rows[0].replicates[0].value = 121;
		expect(pendingWrites(rows).map((w) => w.sensorId)).toEqual([null]);
	});
});

describe('the grid a site opens as', () => {
	const configured = [
		{ parameterId: 'p-doc', code: 'DOC_ppb', name: 'DOC' },
		{ parameterId: 'p-nut', code: 'NUT_P_ugL', name: 'Phosphate' },
		{ parameterId: 'p-chla', code: 'Chla_ugL', name: 'Chlorophyll a' },
	];

	it('holds one row per parameter the site is assigned, stored or not', () => {
		const rows = withConfiguredRows(
			gridFromVisit(visit([cell({ replicates: [stored(0, 120)] })])),
			configured,
		);
		expect(rows.map((r) => r.parameterId)).toEqual(['p-doc', 'p-nut', 'p-chla']);
		expect(rows[0].replicates.map((c) => c.value)).toEqual([120]);
		expect(rows[1].replicates).toEqual([]);
	});

	it('keeps both rows where two streams serve one parameter at the visit', () => {
		const rows = withConfiguredRows(
			gridFromVisit(
				visit([
					cell({ stream_id: 'stream-cnet', source_system: 'cnet', replicates: [stored(0, 120)] }),
					cell({ stream_id: 'stream-grab', source_system: 'grab_sample', replicates: [stored(0, 131)] }),
				]),
			),
			configured,
		);
		expect(rows.map((r) => r.streamId)).toEqual([
			'stream-cnet',
			'stream-grab',
			'',
			'',
		]);
		// The rows are told apart by their stream, so the grid can key them.
		expect(new Set(rows.map(rowKey)).size).toBe(rows.length);
		expect(duplicatedParameters(rows)).toEqual(new Set(['p-doc']));
	});

	it('leaves a stored parameter the site no longer declares on the grid', () => {
		const rows = withConfiguredRows(
			gridFromVisit(visit([cell({ parameter_id: 'p-retired', parameter_code: 'OLD' })])),
			configured,
		);
		expect(rows.map((r) => r.parameterId)).toContain('p-retired');
	});
});

describe('the statistics beside a row', () => {
	// A single-precision 100.8 as the portals store it, so what the grid prints is a display
	// decision rather than an artefact of the number.
	const STORED = 100.8000030517578;
	const withSample = () =>
		gridFromVisit(
			visit([
				cell({
					replicates: [stored(0, STORED)],
					sample: { n: 3, mean: STORED, stdev: 0.15275252316519466, min: 1.1, max: 1.4 },
				} as Partial<EventCell>),
			]),
		)[0];

	it('takes the precision the slot declares', () => {
		expect(rowStats(withSample(), 2)).toEqual({
			n: '3',
			mean: '100.80',
			stdev: '0.15',
			min: '1.10',
			max: '1.40',
		});
	});

	it('leaves an undeclared slot at what was measured, rounded to no precision nobody chose', () => {
		const stats = rowStats(withSample(), null);
		expect(stats.mean).toBe('100.8');
		expect(stats.stdev).toBe('0.152753');
	});

	// A lone measurement forms no sample row, and the serving arm reports it as n = 1. The
	// statistics a single value does not have stay absent.
	it('counts a row with no sample as the one measurement it holds', () => {
		const rows = gridFromVisit(visit([cell({ replicates: [stored(0, 120)] })]));
		expect(rowStats(rows[0], 2)).toEqual({ n: '1', mean: '-', stdev: '-', min: '-', max: '-' });
	});

	it('counts nothing where the lone replicate is excluded from the mean', () => {
		const rows = gridFromVisit(
			visit([cell({ replicates: [{ ...stored(0, 120), flagged: true }] })]),
		);
		expect(rowStats(rows[0], 2).n).toBe('0');
	});
});

describe('narrowing the grid to one parameter group', () => {
	const rows = () =>
		gridFromVisit(
			visit([
				cell({ parameter_id: 'p-doc' }),
				cell({ parameter_id: 'p-nut' }),
				cell({ parameter_id: 'p-loose' }),
			]),
		);
	const groups = { 'p-doc': 'g-carbon', 'p-nut': 'g-nutrients' };

	it('shows every row when no group is chosen', () => {
		expect(rowsInGroup(rows(), groups, '').map((r) => r.parameterId)).toEqual([
			'p-doc',
			'p-nut',
			'p-loose',
		]);
	});

	it('keeps only the chosen group', () => {
		expect(rowsInGroup(rows(), groups, 'g-carbon').map((r) => r.parameterId)).toEqual(['p-doc']);
	});

	it('reaches a parameter belonging to no group', () => {
		expect(rowsInGroup(rows(), groups, 'none').map((r) => r.parameterId)).toEqual(['p-loose']);
	});
});

describe('how many repeats a row opens with', () => {
	it('takes the count from the most recent visit that held the parameter', () => {
		const rows = seedReplicateCounts(
			withConfiguredRows(gridFromVisit(visit([])), [
				{ parameterId: 'p-doc', code: 'DOC_ppb', name: 'DOC' },
			]),
			{ 'p-doc': 3 },
		);
		expect(rows[0].replicates).toHaveLength(3);
		expect(rows[0].replicates.every((c) => c.value === null)).toBe(true);
	});

	it('leaves a row that already holds values alone', () => {
		const rows = seedReplicateCounts(
			gridFromVisit(visit([cell({ replicates: [stored(0, 120)] })])),
			{ 'p-doc': 3 },
		);
		expect(rows[0].replicates).toHaveLength(1);
	});

	it('opens one repeat where the site has no history for the parameter', () => {
		const rows = seedReplicateCounts(
			withConfiguredRows(gridFromVisit(visit([])), [
				{ parameterId: 'p-doc', code: 'DOC_ppb', name: 'DOC' },
			]),
			{},
		);
		expect(rows[0].replicates).toHaveLength(1);
	});
});

describe('adding and removing a repeat by hand', () => {
	it('adds an empty repeat at the end of the row', () => {
		const rows = setReplicateCount(gridFromVisit(visit([cell({ replicates: [stored(0, 120)] })])), 0, 2);
		expect(rows[0].replicates.map((c) => c.value)).toEqual([120, null]);
	});

	it('drops a typed repeat the store does not hold', () => {
		let rows = gridFromVisit(visit([cell({ replicates: [stored(0, 120)] })]));
		rows = setCellValue(rows, 0, 1, 121);
		expect(setReplicateCount(rows, 0, 1)[0].replicates.map((c) => c.value)).toEqual([120]);
	});

	it('refuses to drop a stored replicate, which is a curation decision and not a layout one', () => {
		const rows = gridFromVisit(
			visit([cell({ replicates: [stored(0, 120), stored(1, 122)] })]),
		);
		expect(setReplicateCount(rows, 0, 1)[0].replicates).toHaveLength(2);
	});

	it('never leaves a row with no cell to type into', () => {
		const rows = setReplicateCount(gridFromVisit(visit([cell({ replicates: [] })])), 0, 0);
		expect(rows[0].replicates).toHaveLength(1);
	});
});

describe('refusalMessage', () => {
	it('unwraps the API envelope and leaves anything else alone', () => {
		expect(refusalMessage('{"error":"Check c1 does not exist"}')).toBe('Check c1 does not exist');
		expect(refusalMessage('502 Bad Gateway')).toBe('502 Bad Gateway');
		expect(refusalMessage('{"detail":"no error key"}')).toBe('{"detail":"no error key"}');
	});
});

describe('saveErrors', () => {
	const rows = gridFromVisit(
		visit([
			cell({ parameter_id: 'p-doc', parameter_code: 'DOC_ppb' }),
			cell({ parameter_id: 'p-ph', parameter_code: 'pH' }),
		]),
	);

	it('puts a refusal on the row it names', () => {
		const refusal = JSON.stringify({
			error: 'Value 7.4 for parameter p-ph was not screened by check c1',
		});
		expect(saveErrors(refusal, rows)).toEqual({
			'p-ph': 'Value 7.4 for parameter p-ph was not screened by check c1',
		});
	});

	it('names every row a refusal mentions', () => {
		const refusal = JSON.stringify({ error: 'p-doc and p-ph are not configured for site Sion' });
		expect(Object.keys(saveErrors(refusal, rows)).sort()).toEqual(['p-doc', 'p-ph']);
	});

	it('leaves the grid unmarked when the refusal names no parameter', () => {
		expect(saveErrors('{"error":"Database error"}', rows)).toEqual({});
	});
});

describe('a pending replicate', () => {
	it('arrives on the grid cell, so the value can be drawn as pending', () => {
		const grid = gridFromVisit(
			visit([cell({ replicates: [{ ...stored(0, 120), unverified: true }, stored(1, 122)] })]),
		);
		expect(grid[0].replicates[0].unverified).toBe(true);
		expect(grid[0].replicates[1].unverified).toBe(false);
	});

	it('says in the cell title what pending means for the value', () => {
		expect(cellStateTitle({ value: 1, stored: 1, flagged: false, withdrawn: false, unverified: true })).toContain(
			'Pending',
		);
		expect(cellStateTitle({ value: 1, stored: 1, flagged: false, withdrawn: false, unverified: false })).toBeUndefined();
	});
});

describe('expectedReplicates', () => {
	it('names what the grid read for every group the save carries, and no other', () => {
		const rows = setCellValue(
			gridFromVisit(
				visit([
					cell({ parameter_id: 'p-doc', replicates: [stored(0, 120), stored(2, 118)] }),
					cell({ parameter_id: 'p-ph', replicates: [stored(0, 7.1)] }),
				]),
			),
			0,
			1,
			119,
		);
		const entries = entryGroups(rows);
		expect(expectedReplicates(rows, entries, '2025-06-20T10:30:00Z')).toEqual([
			{ parameter_id: 'p-doc', time: '2025-06-20T10:30:00Z', replicate_indices: [0, 2] },
		]);
	});

	it('names only what is stored, not what was typed', () => {
		const typed = setCellValue(
			gridFromVisit(visit([cell({ parameter_id: 'p-doc', replicates: [stored(0, 120)] })])),
			0,
			1,
			121,
		);
		expect(expectedReplicates(typed, entryGroups(typed), 't')[0].replicate_indices).toEqual([0]);
	});
});
