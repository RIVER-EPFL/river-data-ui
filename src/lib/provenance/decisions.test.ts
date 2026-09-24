import { describe, it, expect } from 'vitest';
import type { LedgerEntry, ReadingDecision } from '$api/service';
import {
	changedFields,
	decisionLabel,
	restoredLines,
	rulingHold,
	timelineEntries,
	undoable,
	withoutSetMembers,
} from './decisions';

const KINDS = [
	'flag',
	'unflag',
	'withdraw',
	'reassert',
	'reject',
	'curve',
	'calibration_pin',
	'instrument_pin',
	'slot_move',
	'value_correction',
	'unverified_entry',
	'verify',
	'chain',
	'detach',
	'return',
	'reprocess',
	'retag',
	'attribution',
	'rollback',
];

function decision(over: Partial<ReadingDecision> = {}): ReadingDecision {
	return {
		id: 'd1',
		stream_id: 's',
		time: '2026-07-14T09:00:00Z',
		kind: 'value_correction',
		old: {},
		new: {},
		actor: 'lab',
		at: '2026-08-02T11:00:00Z',
		origin: 'manual',
		...over,
	} as ReadingDecision;
}

describe('decision labels', () => {
	it('names every kind the record can hold', () => {
		for (const kind of KINDS) {
			expect(decisionLabel(kind), kind).not.toBe(kind);
		}
	});
});

describe('changedFields', () => {
	it('states a correction as before and after', () => {
		const changes = changedFields(
			decision({ old: { raw_value: 8.005 }, new: { raw_value: 11 } }),
		);
		expect(changes).toEqual([{ field: 'raw_value', from: 8.005, to: 11 }]);
	});

	it('reads a rollback through the columns it restores', () => {
		const changes = changedFields(
			decision({
				kind: 'rollback',
				old: { raw_value: 11 },
				new: { columns: { raw_value: 8.005 }, of: 'd1' },
			}),
		);
		expect(changes).toEqual([{ field: 'raw_value', from: 11, to: 8.005 }]);
	});

	it('drops a field the decision asserts without moving it', () => {
		expect(
			changedFields(decision({ old: { raw_value: 8 }, new: { raw_value: 8 } })),
		).toEqual([]);
	});
});

describe('timelineEntries', () => {
	it('collapses the rows of one set into one act and keeps its members', () => {
		const entries = timelineEntries([
			decision({ id: 'a', set_id: 'set-1', replicate_index: 0 }),
			decision({ id: 'b', set_id: 'set-1', replicate_index: 1 }),
			decision({ id: 'c', kind: 'flag' }),
		]);
		expect(entries.map((e) => e.head.id)).toEqual(['a', 'c']);
		expect(entries[0].members.map((m) => m.id)).toEqual(['a', 'b']);
		expect(entries[1].members).toHaveLength(1);
	});
});

describe('withoutSetMembers', () => {
	function entry(id: string, source = 'decision'): LedgerEntry {
		return { at: '2026-08-02T11:00:00Z', source, severity: 'info', what: 'verify', id } as LedgerEntry;
	}

	it('keeps one history line for a three-member set', () => {
		const decisions = [
			decision({ id: 'a', set_id: 'set-1', replicate_index: 0 }),
			decision({ id: 'b', set_id: 'set-1', replicate_index: 1 }),
			decision({ id: 'c', set_id: 'set-1', replicate_index: 2 }),
			decision({ id: 'd', kind: 'flag' }),
		];
		const ledger = [entry('a'), entry('b'), entry('c'), entry('d'), entry('b', 'job')];
		expect(withoutSetMembers(ledger, decisions).map((e) => `${e.source}:${e.id}`)).toEqual([
			'decision:a',
			'decision:d',
			'job:b',
		]);
	});
});

describe('undoable', () => {
	it('takes the API at its word about which kinds rollback accepts', () => {
		expect(undoable(decision({ reversible: true }))).toBe(true);
		expect(undoable(decision({ kind: 'chain', reversible: false }))).toBe(false);
		expect(
			undoable(decision({ reversible: true, rolled_back_by: 'r1' })),
		).toBe(false);
	});

	it('falls back to the kind where an older API sends no verdict', () => {
		expect(undoable(decision({}))).toBe(true);
		expect(undoable(decision({ kind: 'rollback' }))).toBe(false);
	});

	it('offers no undo for a decision a standing ruling recorded', () => {
		expect(
			undoable(decision({ kind: 'verify', reversible: true, ruling_hold_id: 'h1' })),
		).toBe(false);
	});
});

describe('rulingHold', () => {
	it('names the hold a standing ruling is reopened from', () => {
		expect(rulingHold(decision({ kind: 'verify', ruling_hold_id: 'h1' }))).toBe('h1');
	});

	it('names none for a decision no standing ruling recorded', () => {
		expect(rulingHold(decision({ ruling_hold_id: null }))).toBeNull();
		expect(rulingHold(decision({}))).toBeNull();
		expect(
			rulingHold(decision({ kind: 'verify', ruling_hold_id: 'h1', rolled_back_by: 'r1' })),
		).toBeNull();
	});
});

describe('restoredLines', () => {
	it('puts each moved value back from what it holds now to what it held before', () => {
		const lines = restoredLines([
			{
				decision: decision({ replicate_index: 0, old: { raw_value: 10 }, new: { raw_value: 15 } }),
				parameter_code: 'temp',
			},
			{
				decision: decision({ id: 'd2', replicate_index: 1, old: { raw_value: 20 }, new: { raw_value: 25 } }),
				parameter_code: 'do',
			},
		]);
		expect(lines).toEqual(['temp replicate 0: Measured 15 → 10', 'do replicate 1: Measured 25 → 20']);
	});

	it('leaves out a decision already rolled back', () => {
		const lines = restoredLines([
			{
				decision: decision({ rolled_back_by: 'r1', old: { raw_value: 10 }, new: { raw_value: 15 } }),
				parameter_code: 'temp',
			},
		]);
		expect(lines).toEqual([]);
	});

	it('names a withdrawal it lifts and a reading paired to nothing', () => {
		const lines = restoredLines([
			{
				decision: decision({
					kind: 'withdraw',
					replicate_index: null,
					old: { withdrawn_at: null },
					new: { withdrawn_at: '2026-07-14T10:00:00Z' },
				}),
				parameter_code: null,
			},
		]);
		expect(lines).toEqual(['unpaired reading: Withdrawn 2026-07-14T10:00:00Z → nothing']);
	});
});
