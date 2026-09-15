import { describe, expect, it } from 'vitest';

import { verificationBadge, verificationNoticeFor } from './verification';

describe('verificationBadge', () => {
	it('says nothing about a visit that stands accepted', () => {
		expect(verificationBadge(false, null)).toBeNull();
		expect(verificationBadge(undefined, undefined)).toBeNull();
	});

	it('marks a field day awaiting a ruling', () => {
		expect(verificationBadge(true, null)).toEqual({ label: 'pending review', variant: 'warning' });
	});

	it('reads a rejected field day as rejected, not as pending', () => {
		expect(verificationBadge(true, '2026-09-15T08:00:00Z')).toEqual({
			label: 'rejected',
			variant: 'alarm',
		});
	});
});

describe('verificationNoticeFor', () => {
	it('tells a person why a measurement cannot be verified yet', () => {
		expect(verificationNoticeFor(true, null)).toContain('awaiting review');
	});

	it('says a rejected visit is withdrawn', () => {
		expect(verificationNoticeFor(false, '2026-09-15T08:00:00Z')).toContain('withdrawn');
	});

	it('says nothing about a settled visit', () => {
		expect(verificationNoticeFor(false, null)).toBeNull();
	});
});
