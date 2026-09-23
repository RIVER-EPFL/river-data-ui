import { describe, expect, it } from 'vitest';

import type { VisitRow } from '$api/service';
import {
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
	withdrawalKeys,
	pasteNotice,
	instrumentKey,
	hasUnsavedEntries,
	leavingLosesEntries,
} from './tableEdit';
import { keptAfterSave } from './spareRows';

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

	it('takes no keystroke on a column a calculation writes', () => {
		// Q8: a computed value is corrected by running its calculation again, never typed over.
		expect(
			editable({ width: 1, repeats: 1, expanded: false, writtenBy: 'doc' } as never),
		).toBe(false);
		expect(editable({ width: 3, repeats: 3, expanded: true, writtenBy: 'doc' } as never)).toBe(
			false,
		);
		expect(editable({ width: 1, repeats: 1, expanded: false, writtenBy: null } as never)).toBe(
			true,
		);
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

describe('clearing a cell', () => {
	// Q227: a blank on a stored cell withdraws the replicate, reversibly, and a blank on a cell the
	// store holds nothing at cancels the entry.
	it('withdraws a stored replicate when its group takes no new entry', () => {
		const edits = setCell({}, visits[0], 'p-temp', 0, '', LOCALE);
		const [write] = pendingWrites(visits, edits, LOCALE);
		expect(write.withdrawals).toEqual([
			{ parameterId: 'p-temp', streamId: 'stream-temp', replicateIndex: 0 },
		]);
		expect(write.corrections).toEqual([]);
		expect(write.entries).toEqual([]);
		expect(pendingCount(edits, LOCALE)).toBe(1);
	});

	it('leaves a cleared replicate out of the group its entry rewrites', () => {
		// [10, 12]: clear the first and add a third. The replace carries [12, 14] and retracts the
		// first itself, so no separate withdrawal is recorded for it.
		let edits = setCell({}, visits[0], 'p-do', 0, '', LOCALE);
		edits = setCell(edits, visits[0], 'p-do', 2, '14', LOCALE);
		const [write] = pendingWrites(visits, edits, LOCALE);
		expect(write.entries).toEqual([
			{ parameterId: 'p-do', replicateIndex: 1, value: 12, sensorId: null },
			{ parameterId: 'p-do', replicateIndex: 2, value: 14, sensorId: null },
		]);
		expect(write.withdrawals).toEqual([]);
		expect(pendingCount(edits, LOCALE)).toBe(2);
	});

	it('cancels an entry on a cell the store holds nothing at', () => {
		let edits = setCell({}, visits[0], 'p-do', 2, '14', LOCALE);
		edits = setCell(edits, visits[0], 'p-do', 2, '', LOCALE);
		expect(edits).toEqual({});
		expect(pendingWrites(visits, edits, LOCALE)).toEqual([]);
		expect(pendingCount(edits, LOCALE)).toBe(0);
	});

	it('gathers every withdrawal across the table into one selection', () => {
		let edits = setCell({}, visits[0], 'p-temp', 0, '', LOCALE);
		edits = setCell(edits, visits[1], 'p-do', 0, '', LOCALE);
		expect(withdrawalKeys(pendingWrites(visits, edits, LOCALE))).toEqual([
			{ stream_id: 'stream-temp', time: '2026-06-01T08:00:00Z', replicate_index: 0 },
			{ stream_id: 'stream-do', time: '2026-06-01T08:00:00Z', replicate_index: 0 },
		]);
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

describe('what a paste reports', () => {
	it('names what ran past the last column', () => {
		expect(pasteNotice({ edits: {}, unreadable: 0, overflow: 2 })).toContain(
			'2 values ran past the columns listed',
		);
	});

	it('names a cell it could not read', () => {
		expect(pasteNotice({ edits: {}, unreadable: 1, overflow: 0 })).toContain(
			'could not be read as a number',
		);
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

describe('hasUnsavedEntries', () => {
	it('is false with nothing typed and no spare date', () => {
		expect(hasUnsavedEntries({}, {})).toBe(false);
		expect(hasUnsavedEntries({}, { 'new:0': '  ' })).toBe(false);
	});

	it('is true for one typed cell', () => {
		expect(hasUnsavedEntries({ 'v1|p-do|0': '7' }, {})).toBe(true);
	});

	it('is true for a spare date with no cell beside it', () => {
		expect(hasUnsavedEntries({}, { 'new:0': '2026-07-05' })).toBe(true);
	});

	it('is true for what a partial save leaves on screen', () => {
		const kept = keptAfterSave(
			{ 'v1|p-do|0': '7', 'new:0|p-do|0': '8.5' },
			{ 'new:0': '2026-07-05' },
			new Set(['new:0']),
		);
		expect(hasUnsavedEntries(kept.edits, kept.dates)).toBe(true);
	});
});

describe('leavingLosesEntries', () => {
	it('asks when the visits tab is left with something typed', () => {
		expect(leavingLosesEntries('visits', 'charts', true)).toBe(true);
	});

	it('does not ask with nothing typed, or when staying on the visits tab', () => {
		expect(leavingLosesEntries('visits', 'charts', false)).toBe(false);
		expect(leavingLosesEntries('visits', 'visits', true)).toBe(false);
	});

	it('does not ask when leaving another tab', () => {
		expect(leavingLosesEntries('charts', 'visits', true)).toBe(false);
	});
});
