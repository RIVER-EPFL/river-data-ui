import { render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

const listJobs = vi.fn();
vi.mock('$api/crud', () => ({
	api: {
		reprocessingJobs: { list: (q: unknown) => listJobs(q) },
		sensors: { list: () => Promise.resolve({ data: [] }) },
		derivedParameters: { list: () => Promise.resolve({ data: [] }) },
	},
}));

vi.mock('$api/service', () => ({
	getJobLogs: () => Promise.resolve([]),
	rerunJob: vi.fn(),
	cancelJob: vi.fn(),
}));

const JobsPanel = (await import('./JobsPanel.svelte')).default;

// What the worker pool writes on enqueue and on a retry's backoff. Nothing has written `pending`
// since the pool landed, so a panel that knows only `pending` and `running` shows a fresh job as
// terminal: no Cancel, no polling, and no chip that finds it.
const queued = {
	id: 'job-1',
	status: 'queued',
	trigger_type: 'reprocess_all',
	created_at: '2026-07-14T09:00:00Z',
	cancellable: true,
	rerunnable: false,
};

describe('JobsPanel', () => {
	it('offers Cancel on a queued job, which the API honours outright', async () => {
		listJobs.mockResolvedValue({ data: [queued], total: 1 });
		render(JobsPanel, { openJobId: 'job-1' });
		await waitFor(() => expect(screen.getByText('Cancel')).toBeTruthy());
	});

	it('offers a queued chip, the status a fresh job actually carries', async () => {
		listJobs.mockResolvedValue({ data: [], total: 0 });
		render(JobsPanel, {});
		await waitFor(() => expect(screen.getByText('queued')).toBeTruthy());
		expect(screen.queryByText('pending')).toBeNull();
	});
});
