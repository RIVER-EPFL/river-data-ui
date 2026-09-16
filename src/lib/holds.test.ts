import { describe, expect, it } from 'vitest';

import { HOLD_KINDS } from '$api/service';
import {
	AUDIT_QUEUE_KINDS,
	CALCULATION_FINDING_KINDS,
	KIND_LABEL,
	KIND_STYLE,
	KIND_TIP,
	INSTRUMENT_KINDS,
	STREAM_KINDS,
	TAG_KINDS,
	VERIFICATION_KINDS,
	brakeSummary,
	holdHref,
	identityChanges,
} from './holds';

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

describe('where each hold kind is worked', () => {
	it('lists verifications on Visits, calculation findings on the Toolbox and tags on the browse, not in the audits queue', () => {
		for (const kind of [...VERIFICATION_KINDS, ...CALCULATION_FINDING_KINDS, ...TAG_KINDS]) {
			expect(AUDIT_QUEUE_KINDS, `${kind} is still in the audits queue`).not.toContain(kind);
		}
	});

	it('leaves every other kind in the audits queue', () => {
		expect(
			[...AUDIT_QUEUE_KINDS, ...VERIFICATION_KINDS, ...CALCULATION_FINDING_KINDS, ...STREAM_KINDS, ...INSTRUMENT_KINDS, ...TAG_KINDS].sort(),
		).toEqual([...HOLD_KINDS].sort());
	});
});

describe('what a fired brake held back', () => {
	it('names the changes and withdrawals against what the window stores', () => {
		expect(
			brakeSummary({ would_change: 40, would_withdraw: 3, stored_in_window: 120 }),
		).toBe('The pass would change 40 and withdraw 3 of 120 stored readings.');
	});

	it('reads a hold missing its counts as nothing to summarise', () => {
		expect(brakeSummary(null)).toBeNull();
	});
});

describe('where a fired brake is released', () => {
	it('is on the stream, not in the audits queue', () => {
		expect(AUDIT_QUEUE_KINDS).not.toContain('brake_fired');
		expect(STREAM_KINDS).toContain('brake_fired');
	});
});

describe('where a changed device identity is worked', () => {
	it('is on the instrument, not in the audits queue', () => {
		expect(AUDIT_QUEUE_KINDS).not.toContain('source_identity_changed');
		expect(INSTRUMENT_KINDS).toContain('source_identity_changed');
	});
});

describe('where a reading\'s hold chip opens', () => {
	const at = {
		siteId: 'site-1',
		parameterId: 'param-1',
		timeIso: '2026-08-02T10:00:00.000Z',
		eventId: 'event-1',
		streamId: 'stream-1',
		sensorId: 'sensor-1',
	};
	const hold = (kind: string, tool?: string) => ({ id: 'hold-1', kind, status: 'pending', tool });

	it('opens a pending verification on its visit', () => {
		expect(holdHref('', hold('unverified_entry'), at)).toBe('/sites/site-1?tab=visits&event=event-1');
		expect(holdHref('', hold('unverified_visit'), at)).toBe('/sites/site-1?tab=visits&event=event-1');
	});

	it('opens the pending visits when the record names no visit', () => {
		expect(holdHref('', hold('unverified_entry'), { ...at, eventId: undefined })).toBe('/events?pending=1');
	});

	it('opens a calculation finding under its calculation on the Toolbox', () => {
		for (const kind of CALCULATION_FINDING_KINDS) {
			expect(holdHref('', hold(kind, 'doc'), at)).toBe('/toolbox?findings=doc');
		}
		expect(holdHref('', hold('stale_output'), at)).toBe('/toolbox');
	});

	it('opens a fired brake on its stream', () => {
		expect(holdHref('', hold('brake_fired'), at)).toBe('/streams?stats=stream-1');
	});

	it('opens a changed device identity on the instrument', () => {
		expect(holdHref('', hold('source_identity_changed'), at)).toBe('/sensors/sensor-1');
		expect(holdHref('', hold('source_identity_changed'), { ...at, sensorId: undefined })).toBe('/sensors');
	});

	it('opens a source change in the audits queue, resolved ones in its resolved view', () => {
		expect(holdHref('', hold('source_modified'), at)).toBe('/streams?tab=audits&holds_id=hold-1');
		expect(holdHref('', { ...hold('source_modified'), status: 'accepted' }, at)).toBe(
			'/streams?tab=audits&holds_id=hold-1&view=resolved',
		);
	});

	it('opens a tag on the discrepancy browse at the reading', () => {
		for (const kind of TAG_KINDS) {
			expect(holdHref('', hold(kind), at)).toContain(`tags_kind=${kind}`);
			expect(holdHref('', hold(kind), at)).not.toContain('tab=audits');
		}
	});

	it('sends no kind outside the audits queue to the audits tab', () => {
		for (const kind of HOLD_KINDS.filter((k) => !AUDIT_QUEUE_KINDS.includes(k))) {
			if ((TAG_KINDS as string[]).includes(kind)) continue;
			expect(holdHref('', hold(kind, 'doc'), at), kind).not.toContain('tab=audits');
		}
	});
});
