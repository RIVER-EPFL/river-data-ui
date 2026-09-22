import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listReplicateAudits = vi.fn();
vi.mock('$api/service', () => ({
	listReplicateAudits: (...args: unknown[]) => listReplicateAudits(...args),
	dismissCalculationFinding: vi.fn(),
	pollJob: vi.fn(),
	recomputeCollectionEvent: vi.fn(),
	stageCollectionEvent: vi.fn(),
}));
vi.mock('$lib/stores/toast.svelte', () => ({ toastStore: { success: vi.fn(), error: vi.fn() } }));

const CalculationFindings = (await import('./CalculationFindings.svelte')).default;

describe('CalculationFindings', () => {
	beforeEach(() => {
		listReplicateAudits.mockReset().mockResolvedValue({
			holds: [
				{
					id: 'hold-1',
					kind: 'stale_output',
					site_id: 'site-1',
					site_name: 'Martigny',
					parameter_code: 'doc',
					group_time: '2025-03-04T09:00:00Z',
				},
			],
			total: 1,
		});
	});

	it('lists the pending chain findings raised against its calculation', async () => {
		render(CalculationFindings, { calculation: 'doc' });
		expect(await screen.findByText('Martigny')).toBeTruthy();
		expect(listReplicateAudits).toHaveBeenCalledWith(
			expect.objectContaining({
				status: 'pending',
				kind: 'missing_output,stale_output,skipped_output',
				tool: 'doc',
			}),
		);
		expect(screen.getByRole('link', { name: 'Open the visit' })).toBeTruthy();
	});

	it('says so when the calculation has no open finding', async () => {
		listReplicateAudits.mockResolvedValue({ holds: [], total: 0 });
		render(CalculationFindings, { calculation: 'doc' });
		expect(await screen.findByText('No open findings against doc.')).toBeTruthy();
	});
});
