import { render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { base } from '$app/paths';

const list = vi.fn();
vi.mock('$api/crud', () => ({ api: { reprocessingJobs: { list: () => list() } } }));
vi.mock('$api/service', () => ({ getPendingAuditSummary: async () => ({ pending: 0, byKind: {} }) }));
vi.mock('$auth/me.svelte', () => ({ me: { can: () => false } }));
const handlers = vi.hoisted(() => new Map<string, (event: unknown) => void>());
vi.mock('$lib/stores/events.svelte', () => ({
	eventBus: {
		subscribe: (type: string, callback: (event: unknown) => void) => {
			handlers.set(type, callback);
			return () => handlers.delete(type);
		},
	},
}));

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

	it('keeps the total through count-only and retry events, as a reload shows it', async () => {
		list.mockResolvedValue({ data: [{ ...job, progress: 0, total: 22 }], total: 1 });
		render(OperationsIndicator, {});
		(await screen.findByRole('button')).click();
		await screen.findByText('0/22');

		handlers.get('job_progress')?.({ job_id: 'job-7', status: 'running', progress: 10, total: null });
		await screen.findByText('10/22');
		handlers.get('job_progress')?.({ job_id: 'job-7', status: 'retrying', progress: null, total: null });
		await screen.findByText('10/22');

		const loads = list.mock.calls.length;
		list.mockResolvedValue({ data: [{ ...job, status: 'retrying', progress: 10, total: 22 }], total: 1 });
		handlers.get('job_created')?.({ job_id: 'other' });
		await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(loads));
		expect(screen.getByText('10/22')).toBeTruthy();
	});
});
