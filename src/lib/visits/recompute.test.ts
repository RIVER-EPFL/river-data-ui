import { describe, expect, it } from 'vitest';
import {
	RECOMPUTE_BADGE,
	SYNCED_VISIT_NOTICE,
	computedHere,
	computing,
	entryNoticeFor,
	visitBadge,
	visitSourceLabel,
} from './recompute';

describe('visitBadge', () => {
	it('says a portal-synced visit is not calculated, whatever its recompute state', () => {
		for (const state of ['current', 'stale', 'queued', 'running', 'failed']) {
			expect(visitBadge('portal_sync', state)?.label).toBe('not calculated here');
		}
	});

	it('leaves a manual visit its own state', () => {
		expect(visitBadge('manual', 'stale')).toEqual(RECOMPUTE_BADGE.stale);
		expect(visitBadge('manual', 'current')).toBeNull();
		expect(visitBadge(undefined, undefined)).toBeNull();
	});
});

describe('computing', () => {
	it('is true only while the outputs are still being written', () => {
		expect(computing('queued')).toBe(true);
		expect(computing('running')).toBe(true);
		expect(computing('stale')).toBe(false);
		expect(computing(undefined)).toBe(false);
	});
});

describe('entryNoticeFor', () => {
	it('warns on a portal-synced visit and says nothing on one entered here', () => {
		expect(entryNoticeFor('portal_sync')).toBe(SYNCED_VISIT_NOTICE);
		expect(entryNoticeFor('manual')).toBeNull();
		expect(entryNoticeFor(undefined)).toBeNull();
	});
});

describe('computedHere', () => {
	it('is false for a portal-synced visit, whose outputs came with its values', () => {
		expect(computedHere('portal_sync')).toBe(false);
		expect(computedHere('manual')).toBe(true);
		expect(computedHere(undefined)).toBe(true);
	});
});

describe('visitSourceLabel', () => {
	it('names the portal, or the person who typed the values', () => {
		expect(visitSourceLabel('portal_sync')).toBe('Synced from the portal');
		expect(visitSourceLabel('portal_sync', 'aline')).toBe('Synced from the portal');
		expect(visitSourceLabel('manual', 'aline')).toBe('Entered manually by aline');
		expect(visitSourceLabel('manual')).toBe('Entered manually');
		expect(visitSourceLabel(undefined, null)).toBe('Entered manually');
	});
});
