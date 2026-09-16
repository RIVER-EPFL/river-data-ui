import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listReplicateAudits = vi.fn();
vi.mock('$api/service', () => ({
	listReplicateAudits: (...args: unknown[]) => listReplicateAudits(...args),
	resolveReplicateAudit: vi.fn(),
}));
vi.mock('$lib/stores/toast.svelte', () => ({ toastStore: { success: vi.fn(), error: vi.fn() } }));

const PendingVerifications = (await import('./PendingVerifications.svelte')).default;

describe('PendingVerifications', () => {
	beforeEach(() => {
		listReplicateAudits.mockReset().mockResolvedValue({
			holds: [
				{
					id: 'hold-1',
					kind: 'unverified_entry',
					site_id: 'site-1',
					site_name: 'Martigny',
					parameter_name: 'Dissolved organic carbon',
					group_time: '2025-03-04T09:00:00Z',
					computed: { state: 'unverified', entered_by: 'intern1@test.local' },
				},
			],
			total: 1,
		});
	});

	it('lists the pending field days and entries with who entered them', async () => {
		render(PendingVerifications);
		expect(await screen.findByText('intern1@test.local')).toBeTruthy();
		expect(screen.getByText('Dissolved organic carbon')).toBeTruthy();
		expect(listReplicateAudits).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'pending', kind: 'unverified_visit,unverified_entry' }),
		);
	});
});
