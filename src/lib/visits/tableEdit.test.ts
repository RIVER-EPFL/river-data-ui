import { describe, expect, it } from 'vitest';

import type { VisitRow } from '$api/service';
import {
	cellText,
	editable,
	pendingCount,
	pendingWrites,
	setCell,
	slotKey,
	storedAt,
	entryValues,
	checkSignature,
	checkSatisfied,
	correctionKeys,
	applyPaste,
	copyBlock,
	pasteNotice,
	instrumentKey,
} from './tableEdit';
import { parameterColumns, slotsOf } from './columns';

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

function visit(id: string, cells: Record<string, ReturnType<typeof replicate>[]>): VisitRow {
	return {
		id,
		collected_at: '2026-06-01T08:00:00Z',
		source: 'manual',
		parameters_filled: Object.keys(cells).length,
		findings_open: 0,
		unverified: false,
		recompute: 'current',
		cells: Object.entries(cells).map(([parameter_id, replicates]) => ({
			parameter_id,
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

const visits = [
	visit('v1', { 'p-do': [replicate(0, 10), replicate(1, 12)], 'p-temp': [replicate(0, 4.2, 'stream-temp')] }),
	visit('v2', { 'p-do': [replicate(0, 9)] }),
];

describe('typing into the visits table', () => {
	it('takes a keystroke on a single column and on an open group, never on a mean', () => {
		expect(editable({ width: 1, repeats: 1, expanded: false } as never)).toBe(true);
		expect(editable({ width: 3, repeats: 3, expanded: true } as never)).toBe(true);
		// Collapsed over repeats the cell shows their mean, which is nobody's to type.
		expect(editable({ width: 1, repeats: 3, expanded: false } as never)).toBe(false);
	});

	it('shows what was typed over what was stored', () => {
		const edits = { [slotKey({ eventId: 'v1', parameterId: 'p-do', replicateIndex: 0 })]: '11' };
		expect(cellText(edits, visits[0], 'p-do', 0, String)).toBe('11');
		expect(cellText(edits, visits[0], 'p-do', 1, String)).toBe('12');
		expect(cellText(edits, visits[0], 'p-do', 2, String)).toBe('');
	});

	it('drops an edit that types the stored value back', () => {
		let edits = setCell({}, visits[0], 'p-do', 0, '11', LOCALE);
		expect(Object.keys(edits)).toHaveLength(1);
		edits = setCell(edits, visits[0], 'p-do', 0, '10', LOCALE);
		expect(edits).toEqual({});
	});

	it('drops a cleared cell the store holds nothing at', () => {
		const edits = setCell({}, visits[0], 'p-do', 5, '', LOCALE);
		expect(edits).toEqual({});
	});

	it('reads a stored replicate by its own index', () => {
		expect(storedAt(visits[0], 'p-do', 1)?.value).toBe(12);
		expect(storedAt(visits[0], 'p-do', 9)).toBeNull();
	});

	it('keys a correction on the stream the replicate came in on', () => {
		const edits = setCell({}, visits[0], 'p-temp', 0, '4.5', LOCALE);
		const [write] = pendingWrites(visits, edits, LOCALE);
		expect(write.eventId).toBe('v1');
		expect(write.corrections).toEqual([
			{ parameterId: 'p-temp', streamId: 'stream-temp', replicateIndex: 0, value: 4.5 },
		]);
		expect(write.entries).toEqual([]);
	});

	it('carries a whole group when one of its slots is a new entry', () => {
		const edits = setCell({}, visits[0], 'p-do', 2, '14', LOCALE);
		const [write] = pendingWrites(visits, edits, LOCALE);
		expect(write.corrections).toEqual([]);
		expect(write.entries).toEqual([
			{ parameterId: 'p-do', replicateIndex: 0, value: 10, sensorId: null },
			{ parameterId: 'p-do', replicateIndex: 1, value: 12, sensorId: null },
			{ parameterId: 'p-do', replicateIndex: 2, value: 14, sensorId: null },
		]);
	});

	it('writes each visit it touched, and no others', () => {
		let edits = setCell({}, visits[0], 'p-do', 0, '11', LOCALE);
		edits = setCell(edits, visits[1], 'p-do', 0, '9.5', LOCALE);
		const writes = pendingWrites(visits, edits, LOCALE);
		expect(writes.map((w) => w.eventId)).toEqual(['v1', 'v2']);
		expect(pendingCount(edits, LOCALE)).toBe(2);
	});

	it('counts the cells that moved, not the values the payload carries', () => {
		const edits = setCell({}, visits[0], 'p-do', 2, '14', LOCALE);
		expect(pendingCount(edits, LOCALE)).toBe(1);
		expect(pendingWrites(visits, edits, LOCALE)[0].entries).toHaveLength(3);
	});
});

describe('the gates a table save passes', () => {
	it('screens the entry half of each visit, and re-arms when a value moves', () => {
		const edits = setCell({}, visits[0], 'p-do', 2, '14', LOCALE);
		const [write] = pendingWrites(visits, edits, LOCALE);
		expect(entryValues(write)).toEqual([
			{ parameter_id: 'p-do', value: 10 },
			{ parameter_id: 'p-do', value: 12 },
			{ parameter_id: 'p-do', value: 14 },
		]);

		const checks = { v1: { id: 'check-1', signature: checkSignature(write) } };
		expect(checkSatisfied([write], checks)).toBe(true);

		const moved = setCell(edits, visits[0], 'p-do', 2, '15', LOCALE);
		const [after] = pendingWrites(visits, moved, LOCALE);
		expect(checkSatisfied([after], checks)).toBe(false);
	});

	it('asks for no screening where the save only corrects', () => {
		const edits = setCell({}, visits[0], 'p-temp', 0, '4.5', LOCALE);
		const writes = pendingWrites(visits, edits, LOCALE);
		expect(checkSatisfied(writes, {})).toBe(true);
	});

	it('gathers every correction across the table into one selection', () => {
		let edits = setCell({}, visits[0], 'p-temp', 0, '4.5', LOCALE);
		edits = setCell(edits, visits[1], 'p-do', 0, '9.5', LOCALE);
		expect(correctionKeys(pendingWrites(visits, edits, LOCALE))).toEqual([
			{
				stream_id: 'stream-temp',
				time: '2026-06-01T08:00:00Z',
				replicate_index: 0,
				value: 4.5,
			},
			{ stream_id: 'stream-do', time: '2026-06-01T08:00:00Z', replicate_index: 0, value: 9.5 },
		]);
	});
});


describe('a block travelling between the table and a spreadsheet', () => {
	const slots = slotsOf(
		parameterColumns(
			[
				{ parameter_id: 'p-do', code: 'DO', name: 'Dissolved oxygen' },
				{ parameter_id: 'p-temp', code: 'Temp', name: 'Temperature' },
			],
			visits,
			new Set(),
		),
	);

	it('copies out in the order the table lists its dates', () => {
		expect(
			copyBlock(visits, slots, {}, { row: 0, column: 0, height: 2, width: 2 }, String),
		).toBe('10\t4.2\n9\t');
	});

	it('fills down the visits listed below the cell it was pasted at', () => {
		const paste = applyPaste(visits, slots, {}, 0, 0, '11\n9.5', LOCALE);
		expect(paste.overflow).toBe(0);
		expect(pendingWrites(visits, paste.edits, LOCALE).map((w) => w.corrections)).toEqual([
			[{ parameterId: 'p-do', streamId: 'stream-do', replicateIndex: 0, value: 11 }],
			[{ parameterId: 'p-do', streamId: 'stream-do', replicateIndex: 0, value: 9.5 }],
		]);
	});

	it('counts what ran past the last listed visit rather than inventing one', () => {
		const paste = applyPaste(visits, slots, {}, 0, 0, '11\n9.5\n8\n7', LOCALE);
		expect(paste.overflow).toBe(2);
		expect(pasteNotice(paste)).toContain('2 values ran past the visits listed');
	});

	it('leaves a blank cell alone and counts one it cannot read', () => {
		const paste = applyPaste(visits, slots, {}, 0, 0, '\tnot a number', LOCALE);
		expect(paste.edits).toEqual({});
		expect(paste.unreadable).toBe(1);
		expect(pasteNotice(paste)).toContain('could not be read as a number');
	});

	it('says nothing when a block landed whole', () => {
		expect(pasteNotice({ edits: {}, unreadable: 0, overflow: 0 })).toBeNull();
	});
});

describe('the instrument a group declares', () => {
	it('travels on every value the group enters, and on no other group', () => {
		let edits = setCell({}, visits[0], 'p-do', 2, '14', LOCALE);
		edits = setCell(edits, visits[0], 'p-temp', 1, '4.5', LOCALE);
		const [write] = pendingWrites(visits, edits, LOCALE, {
			[instrumentKey('v1', 'p-do')]: 'sensor-analyser',
		});
		expect(write.entries.filter((e) => e.parameterId === 'p-do').every((e) => e.sensorId === 'sensor-analyser')).toBe(true);
		expect(write.entries.filter((e) => e.parameterId === 'p-temp').every((e) => e.sensorId === null)).toBe(true);
	});
});
