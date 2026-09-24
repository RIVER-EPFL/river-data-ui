import { describe, expect, it } from 'vitest';

import { notesChanged, visitFacts } from './metadata';

const when = (iso: string) => `[${iso}]`;

describe('visitFacts', () => {
	it('names a typed visit by who entered it and reads it as accepted', () => {
		const facts = visitFacts(
			{ collected_at: '2026-09-01T08:00:00Z', source: 'manual', created_by: 'river1', unverified: false },
			when,
		);
		expect(facts).toEqual([
			{ label: 'Collected at', value: '[2026-09-01T08:00:00Z]' },
			{ label: 'Source', value: 'Entered manually' },
			{ label: 'Created by', value: 'river1' },
			{ label: 'Verification', value: 'Accepted' },
		]);
	});

	it('names a synced visit as the portal and leaves out an unknown creator', () => {
		const facts = visitFacts({ collected_at: '2026-09-01T08:00:00Z', source: 'portal_sync', unverified: false }, when);
		expect(facts.map((f) => f.label)).toEqual(['Collected at', 'Source', 'Verification']);
		expect(facts[1].value).toBe('Synced from the portal');
	});

	it('reads a pending field day as pending review', () => {
		const facts = visitFacts({ collected_at: '2026-09-01T08:00:00Z', source: 'manual', unverified: true }, when);
		expect(facts.at(-1)).toEqual({ label: 'Verification', value: 'Pending review' });
	});

	it('reads a rejected field day as rejected with its date, over pending', () => {
		const facts = visitFacts(
			{ collected_at: '2026-09-01T08:00:00Z', source: 'manual', unverified: true, withdrawn_at: '2026-09-02T09:00:00Z' },
			when,
		);
		expect(facts.at(-1)).toEqual({ label: 'Verification', value: 'Rejected on [2026-09-02T09:00:00Z]' });
	});
});

describe('notesChanged', () => {
	it('sees no change between an empty draft and no notes', () => {
		expect(notesChanged('', undefined)).toBe(false);
		expect(notesChanged('  ', null)).toBe(false);
	});

	it('sees a typed note as a change', () => {
		expect(notesChanged('Snow on the bank', undefined)).toBe(true);
		expect(notesChanged('Snow on the bank', 'Snow')).toBe(true);
	});

	it('ignores surrounding whitespace', () => {
		expect(notesChanged('Snow ', 'Snow')).toBe(false);
	});
});
