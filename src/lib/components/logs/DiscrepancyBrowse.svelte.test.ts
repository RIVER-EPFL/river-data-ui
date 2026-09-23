import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listReplicateAudits = vi.fn();
vi.mock('$api/service', () => ({
	listReplicateAudits: (q: unknown) => listReplicateAudits(q),
}));
vi.mock('$api/crud', () => ({
	api: {
		sites: { list: vi.fn(async () => ({ data: [], total: 0 })) },
		parameters: { list: vi.fn(async () => ({ data: [], total: 0 })) },
	},
}));

const DiscrepancyBrowse = (await import('./DiscrepancyBrowse.svelte')).default;

function tag(extra: Record<string, unknown> = {}) {
	return {
		id: 'hold-1',
		stream_id: 'stream-1',
		kind: 'replicate_stats',
		source_system: 'cnet',
		source_key: 'FP3:DOC_avg_ppb:reps',
		source_name: null,
		site_id: 'site-1',
		site_parameter_id: 'sp-1',
		site_name: 'FP3',
		parameter_name: 'DOC',
		parameter_code: 'DOC',
		tool: null,
		paired: true,
		group_time: '2021-07-14T09:00:00Z',
		expected: { mean: 20, sd: 8.16, n: 4 },
		computed: { mean: 20.5, sd: 10, n: 3 },
		delta: { mean: -0.5, sd: -1.84 },
		status: 'deferred',
		classification: 'unexplained',
		resolution: null,
		created_at: '2021-07-15T00:00:00Z',
		acknowledged_by: null,
		acknowledged_at: null,
		relative_delta: 0.2,
		mean_relative_delta: 0.02,
		sd_relative_delta: 0.2,
		awaiting_inputs: [],
		...extra,
	};
}

beforeEach(() => vi.clearAllMocks());

describe('DiscrepancyBrowse', () => {
	it('lists each tag with both sides and a link to its reading, and offers no action', async () => {
		listReplicateAudits.mockResolvedValue({ holds: [tag()], total: 1, pending: 0, deferred: 1, pending_by_kind: {} });
		const { container } = render(DiscrepancyBrowse, {});
		await screen.findByText('FP3 · DOC');
		expect(container.textContent).toContain('mean 20, sd 8.16, n 4');
		expect(container.textContent).toContain('mean 20.5, sd 10, n 3');
		expect(container.querySelector('a[href*="/sites/site-1?point=sp-1"]')).not.toBeNull();
		expect(screen.queryByRole('button', { name: /acknowledge|mark reviewed|resolve/i })).toBeNull();
		expect(listReplicateAudits.mock.calls[0][0]).toMatchObject({ status: 'any' });
	});

	it('opens on the filter it arrived with', async () => {
		listReplicateAudits.mockResolvedValue({ holds: [], total: 0, pending: 0, deferred: 0, pending_by_kind: {} });
		render(DiscrepancyBrowse, {
			initial: {
				siteId: 'site-1',
				parameterId: 'param-1',
				from: '2021-07-14T09:00:00.000Z',
				to: '2021-07-14T09:00:00.001Z',
			},
		});
		await screen.findByText(/No discrepancies/);
		expect(listReplicateAudits.mock.calls[0][0]).toMatchObject({
			site_id: 'site-1',
			parameter_id: 'param-1',
			from: '2021-07-14T09:00:00.000Z',
			to: '2021-07-14T09:00:00.001Z',
		});
		expect(screen.getByText("One reading's instant")).toBeTruthy();
	});
});
