import { describe, expect, it } from 'vitest';
import { RECOMPUTE_BADGE, computing, visitBadge } from './recompute';

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
