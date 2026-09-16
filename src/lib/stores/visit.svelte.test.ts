import { describe, expect, it, vi } from 'vitest';

vi.mock('$api/service', () => ({ getCollectionEventDetail: vi.fn() }));
vi.mock('$api/crud', () => ({ api: {} }));

const { stagedVisitFrom } = await import('./visit.svelte');

describe('stagedVisitFrom', () => {
	it('stages the visit being read, not the one last staged', () => {
		const visit = { id: 'event', site_id: 'site', collected_at: '2026-07-14T09:00:00Z' };
		expect(stagedVisitFrom(visit, 'FP1')).toEqual({
			eventId: 'event',
			siteId: 'site',
			siteName: 'FP1',
			collectedAt: '2026-07-14T09:00:00Z',
		});
	});
});
