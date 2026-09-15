import { describe, expect, it } from 'vitest';

import { HOLD_KINDS, type LedgerEntry } from '$api/service';
import { DECISION_KINDS } from './decisions';
import { CHANGE_KINDS, ledgerLine, ledgerWeight } from './ledger';

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
			readsAsProse(ledgerLine(entry('decision', kind)).text, kind);
		}
	});

	it('labels a decision carrying its reason by the kind alone', () => {
		expect(ledgerLine(entry('decision', 'withdraw: the probe was out of the water')).text).toBe(
			'Withdrawn',
		);
	});

	it('labels every hold kind the API raises, with what became of it', () => {
		for (const kind of HOLD_KINDS) {
			const line = ledgerLine(entry('hold', `${kind} (pending)`));
			readsAsProse(line.text, kind);
			expect(line.text).toContain('waiting for a ruling');
		}
	});

	it('labels every catalogue and slot change the reading ledger reads', () => {
		for (const kind of CHANGE_KINDS) {
			readsAsProse(ledgerLine(entry('change', kind)).text, kind);
		}
	});

	it('names a job by what it was for and how it ended', () => {
		expect(ledgerLine(entry('job', 'derived_recompute completed')).text).toBe(
			'Derived recompute completed',
		);
		expect(ledgerLine(entry('job', 'manual_reprocess failed: pool timeout')).text).toBe(
			'Manual reprocess failed: pool timeout',
		);
	});

	it('reads an ingest pass by its counts, and a braked one by the brake', () => {
		expect(ledgerLine(entry('ingest', 'ignored', { new: { new: 3, changed: 1 } })).text).toBe(
			'Reloaded from the source: 3 new, 1 changed',
		);
		expect(ledgerLine(entry('ingest', 'ignored', { new: { braked: true } })).text).toBe(
			'Reload from the source stopped by the brake',
		);
	});

	it('names the tool a run executed and how it was minted', () => {
		expect(ledgerLine(entry('tool_run', 'doc (chain)')).text).toBe(
			'Calculated by doc, run by a chain run',
		);
	});

	it('prints what an arm this build does not know said', () => {
		expect(ledgerLine(entry('whatever', 'something happened')).text).toBe('something happened');
	});
});

describe('ledgerWeight', () => {
	it('weights what moved the value above what administers it', () => {
		expect(ledgerWeight(entry('decision', 'value_correction'))).toBe('value');
		expect(ledgerWeight(entry('tool_run', 'doc (interactive)'))).toBe('value');
		expect(ledgerWeight(entry('change', 'parameter_insert'))).toBe('administrative');
		expect(ledgerWeight(entry('hold', 'replicate_stats (acknowledged)'))).toBe('administrative');
		expect(ledgerWeight(entry('ingest', 'x', { new: { new: 0, changed: 0 } }))).toBe(
			'administrative',
		);
	});

	it('weights a job by whether it moved rows', () => {
		expect(
			ledgerWeight(entry('job', 'event_recompute completed', { new: { readings_updated: 0 } })),
		).toBe('administrative');
		expect(
			ledgerWeight(entry('job', 'derived_recompute completed', { new: { readings_updated: 4 } })),
		).toBe('value');
	});

	it('never fades a failure or a warning', () => {
		expect(ledgerWeight(entry('job', 'janitor_service failed: x', { severity: 'error' }))).toBe(
			'value',
		);
		expect(ledgerWeight(entry('hold', 'replicate_stats (pending)', { severity: 'warning' }))).toBe(
			'value',
		);
	});
});
