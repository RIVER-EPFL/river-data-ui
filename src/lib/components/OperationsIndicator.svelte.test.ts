import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { base } from '$app/paths';

const list = vi.fn();
vi.mock('$api/crud', () => ({ api: { reprocessingJobs: { list: () => list() } } }));
vi.mock('$api/service', () => ({ getPendingAuditSummary: async () => ({ pending: 0, byKind: {} }) }));
vi.mock('$auth/me.svelte', () => ({ me: { can: () => false } }));

const OperationsIndicator = (await import('./OperationsIndicator.svelte')).default;

const job = {
	id: 'job-7',
	trigger_type: 'plan_apply',
	trigger_id: 'plan-3',
	status: 'running',
	progress: 22,
	total: 22,
	created_at: '2026-09-09T08:00:00Z',
	completed_at: null,
	error_message: null,
	detail: null,
};

describe('operations indicator', () => {
	it('opens the job it announces, by id, under a name a reader knows', async () => {
		list.mockResolvedValue({ data: [job], total: 1 });
		render(OperationsIndicator, {});
		await screen.findByRole('button');
		(await screen.findByRole('button')).click();
		const link = await screen.findByRole('link', { name: /Applying pairing plan/ });
		expect(link.getAttribute('href')).toContain('/system?tab=jobs&job=job-7');
	});

	it('links View all straight to the System page Jobs tab', async () => {
		list.mockResolvedValue({ data: [job], total: 1 });
		render(OperationsIndicator, {});
		(await screen.findByRole('button')).click();
		const link = await screen.findByRole('link', { name: 'View all' });
		expect(link.getAttribute('href')).toBe(`${base}/system?tab=jobs`);
	});
});
