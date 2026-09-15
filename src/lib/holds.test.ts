import { describe, expect, it } from 'vitest';

import { HOLD_KINDS } from '$api/service';
import { KIND_LABEL, KIND_STYLE, KIND_TIP, identityChanges } from './holds';

describe('the review queue speaks for every hold kind', () => {
	it('labels, styles and explains each one', () => {
		for (const kind of HOLD_KINDS) {
			expect(KIND_LABEL[kind], `${kind} has no label`).toBeTruthy();
			expect(KIND_STYLE[kind], `${kind} has no chip style`).toBeTruthy();
			expect(KIND_TIP[kind], `${kind} has no explanation`).toBeTruthy();
		}
	});

	it('carries the hand-entry hold an intern save raises', () => {
		expect(HOLD_KINDS).toContain('unverified_entry');
	});
});

describe('what a source-identity hold says changed', () => {
	it('reads the fields the source reported differently, with both sides', () => {
		const changes = identityChanges(
			{ was: { serial_number: '1234', model: 'HMP155' }, fields: ['serial_number'] },
			{ now: { serial_number: '5678', model: 'HMP155' } },
		);
		expect(changes).toEqual([{ field: 'serial_number', was: '1234', now: '5678' }]);
	});

	it('compares every field either side carries when the hold names none', () => {
		const changes = identityChanges({ was: { serial_number: '1234' } }, { now: { model: 'WXT' } });
		expect(changes).toEqual([
			{ field: 'serial_number', was: '1234', now: 'not reported' },
			{ field: 'model', was: 'not reported', now: 'WXT' },
		]);
	});

	it('reads a hold carrying neither side as nothing to show', () => {
		expect(identityChanges(null, undefined)).toEqual([]);
	});
});
