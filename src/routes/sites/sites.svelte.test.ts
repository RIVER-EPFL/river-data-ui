import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const list = vi.fn();

vi.mock('$auth/me.svelte', () => ({ me: { can: () => false } }));
vi.mock('$api/paged', () => ({ listAll: async () => [] }));
vi.mock('$api/service', () => ({
	getBackfillCandidates: async () => ({ by_site: [], total_claimable: 0 }),
	backfillAttribution: vi.fn(),
	reprocessAll: vi.fn(),
	reconcileAlarms: vi.fn(),
}));
vi.mock('$api/crud', () => ({
	api: {
		sites: { list },
		sensorDeployments: { list: async () => ({ data: [], total: 0 }) },
	},
}));

const Sites = (await import('./+page.svelte')).default;

function site(i: number) {
	return {
		id: `site-${i}`,
		code: `S${i}`,
		name: `Site ${i}`,
		project_id: 'project-1',
		subproject_id: null,
		latitude: null,
		longitude: null,
		discovered_at: null,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
	};
}

function answer(total: number, page = 1) {
	const first = (page - 1) * 25 + 1;
	const count = Math.max(0, Math.min(25, total - first + 1));
	return { data: Array.from({ length: count }, (_, i) => site(first + i)), total };
}

describe('sites list paging', () => {
	beforeEach(() => list.mockReset());

	it('shows the total when every site fits on one page', async () => {
		list.mockResolvedValue(answer(12));
		render(Sites);
		expect(await screen.findByText('12 total')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
	});

	it('asks for the next page', async () => {
		list.mockImplementation(async (opts?: { page: number }) => answer(30, opts?.page ?? 1));
		render(Sites);
		expect(await screen.findByText('1 / 2')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		expect(await screen.findByText('2 / 2')).toBeTruthy();
		expect(list.mock.lastCall?.[0]).toMatchObject({ page: 2 });
	});
});
