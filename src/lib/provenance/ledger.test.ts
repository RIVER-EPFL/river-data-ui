import { describe, expect, it } from 'vitest';

import { HOLD_KINDS, type LedgerEntry, type ReadingDecision } from '$api/service';
import { formatDateTime } from '$lib/utils';
import { DECISION_KINDS } from './decisions';
import { CHANGE_KINDS, historyRows, ledgerLine } from './ledger';

function entry(source: string, what: string, extra: Partial<LedgerEntry> = {}): LedgerEntry {
	return {
		id: 'e1',
		at: '2026-09-15T09:00:00Z',
		severity: 'info',
		source,
		what,
		...extra,
	} as LedgerEntry;
}

/// A label is plain words: not the code it labels, and never carrying one.
function readsAsProse(text: string, code: string) {
	expect(text).not.toBe(code);
	expect(text).not.toMatch(/[a-z]_[a-z]/);
}

describe('ledgerLine', () => {
	it('labels every decision kind the API records', () => {
		for (const kind of DECISION_KINDS) {
			readsAsProse(ledgerLine(entry('decision', kind)), kind);
		}
	});

	it('labels a decision carrying its reason by the kind alone', () => {
		expect(ledgerLine(entry('decision', 'withdraw: the probe was out of the water'))).toBe(
			'Withdrawn',
		);
	});

	it('labels every hold kind the API raises, with what became of it', () => {
		for (const kind of HOLD_KINDS) {
			const line = ledgerLine(entry('hold', `${kind} (pending)`));
			readsAsProse(line, kind);
			expect(line).toContain('waiting for a ruling');
		}
	});

	it('labels every catalogue and slot change the reading ledger reads', () => {
		for (const kind of CHANGE_KINDS) {
			readsAsProse(ledgerLine(entry('change', kind)), kind);
		}
	});

	it('names a job by what it was for and how it ended', () => {
		expect(ledgerLine(entry('job', 'derived_recompute completed'))).toBe(
			'Derived recompute completed',
		);
		expect(ledgerLine(entry('job', 'manual_reprocess failed: pool timeout'))).toBe(
			'Manual reprocess failed: pool timeout',
		);
	});

	it('reads an ingest pass by every count and its window, and a braked one by the brake', () => {
		const line = ledgerLine(
			entry('ingest', 'ignored', {
				new: {
					submitted: 3,
					new: 0,
					changed: 0,
					unchanged: 3,
					withdrawn: 0,
					rejected: 0,
					window_from: '0001-01-01T00:00:00Z',
					window_to: '2024-09-24T00:00:00Z',
				},
			}),
		);
		expect(line).toBe(
			`Reloaded from the source: 3 submitted, 0 new, 0 changed, 3 unchanged, 0 withdrawn, 0 rejected; window from the beginning to ${formatDateTime('2024-09-24T00:00:00Z')}`,
		);
		expect(ledgerLine(entry('ingest', 'ignored', { new: { braked: true } }))).toBe(
			'Reload from the source stopped by the brake',
		);
	});

	it('names the stream a value arrived on and the stream paired to its slot', () => {
		const stream = { source_system: 'cnet', source_key: 'FP11:A_T' };
		expect(ledgerLine(entry('arrival', 'arrived', { new: { ...stream, origin: 'sync' } }))).toMatch(
			/^Arrived on cnet · FP11:A_T, /,
		);
		expect(ledgerLine(entry('pairing', 'paired', { new: stream }))).toBe(
			'Stream cnet · FP11:A_T paired to this parameter at the site',
		);
	});

	it('names the tool a run executed and how it was minted', () => {
		expect(ledgerLine(entry('tool_run', 'doc (chain)'))).toBe(
			'Calculated by doc, run by a chain run',
		);
	});

	it('prints what an arm this build does not know said', () => {
		expect(ledgerLine(entry('whatever', 'something happened'))).toBe('something happened');
	});
});

function decision(over: Partial<ReadingDecision>): ReadingDecision {
	return {
		id: 'd1',
		stream_id: 'stream',
		time: '2024-09-17T10:00:00Z',
		replicate_index: 0,
		kind: 'value_correction',
		old: { raw_value: 8.005 },
		new: { raw_value: 8.11 },
		actor: 'lab',
		at: '2026-08-02T11:00:00Z',
		reason: 'typo in the field sheet',
		origin: 'manual',
		reversible: true,
		supersedes: null,
		rolled_back_by: null,
		set_id: null,
		job_id: null,
		...over,
	} as ReadingDecision;
}

function decided(d: ReadingDecision): LedgerEntry {
	return entry('decision', d.kind, { id: d.id, at: d.at, actor: d.actor, decision: d });
}

describe('historyRows', () => {
	it('gives a decision row its change, reason, who and the decision to roll back', () => {
		const [row] = historyRows([decided(decision({}))]);
		expect(row.what).toBe('Value corrected');
		expect(row.changes).toEqual([{ field: 'raw_value', from: 8.005, to: 8.11 }]);
		expect(row.reason).toBe('typo in the field sheet');
		expect(row.who).toBe('lab');
		expect(row.origin).toBe('person');
		expect(row.decision?.head.id).toBe('d1');
	});

	it('gives a job row no change and nothing to roll back', () => {
		const [row] = historyRows([
			entry('job', 'event_recompute completed', { actor: undefined, new: { readings_updated: 0 } }),
		]);
		expect(row.what).toBe('Visit recompute completed');
		expect(row.changes).toEqual([]);
		expect(row.reason).toBeNull();
		expect(row.origin).toBe('job');
		expect(row.decision).toBeNull();
	});

	it('orders every dated entry newest first in one list', () => {
		const rows = historyRows([
			entry('change', 'parameter_insert', { id: 'c', at: '2026-09-24T13:38:00Z' }),
			entry('job', 'event_recompute completed', { id: 'j', at: '2026-09-24T13:53:00Z' }),
			decided(decision({ id: 'd', at: '2026-09-24T13:40:00Z' })),
			entry('change', 'site_parameter_insert', { id: 's', at: '2026-09-24T13:39:00Z' }),
		]);
		expect(rows.map((r) => r.entry.id)).toEqual(['j', 'd', 's', 'c']);
	});

	it('keeps one row for a set, under its first decision', () => {
		const rows = historyRows([
			decided(decision({ id: 'a', kind: 'verify', set_id: 'set-1', replicate_index: 0 })),
			decided(decision({ id: 'b', kind: 'verify', set_id: 'set-1', replicate_index: 1 })),
			decided(decision({ id: 'c', kind: 'flag' })),
			entry('job', 'event_recompute completed', { id: 'b' }),
		]);
		expect(rows.map((r) => `${r.entry.source}:${r.entry.id}`).sort()).toEqual([
			'decision:a',
			'decision:c',
			'job:b',
		]);
		expect(rows.find((r) => r.entry.id === 'a')?.decision?.members).toHaveLength(2);
	});
});
