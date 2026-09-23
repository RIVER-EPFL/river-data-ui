import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listReplicateAudits = vi.fn();
const getRejectPreview = vi.fn();
vi.mock('$api/service', () => ({
	listReplicateAudits: (...args: unknown[]) => listReplicateAudits(...args),
	getRejectPreview: (...args: unknown[]) => getRejectPreview(...args),
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
					awaiting_inputs: [],
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

	it('names the computed values a reject would withdraw before it is confirmed', async () => {
		getRejectPreview.mockReset().mockResolvedValue({
			hold_id: 'hold-1',
			entries: 1,
			withdrawn: [
				{
					parameter_id: 'p-pco2',
					code: 'pCO2_uatm',
					name: 'pCO2',
					time: '2025-03-04T09:00:00Z',
					replicate_index: 0,
					value: 412.5,
				},
			],
		});
		render(PendingVerifications);
		await fireEvent.click(await screen.findByText('intern1@test.local'));
		expect(await screen.findByText(/pCO2/)).toBeTruthy();
		expect(screen.getByText(/412\.5/)).toBeTruthy();
		expect(getRejectPreview).toHaveBeenCalledWith('hold-1');
	});

	it('offers no verify on a computed value whose inputs are still pending', async () => {
		listReplicateAudits.mockReset().mockResolvedValue({
			holds: [
				{
					id: 'hold-2',
					kind: 'unverified_entry',
					site_id: 'site-1',
					site_name: 'Martigny',
					parameter_name: 'pCO2',
					group_time: '2025-03-04T09:00:00Z',
					computed: { state: 'unverified', entered_by: 'intern1@test.local' },
					awaiting_inputs: [{ parameter_id: 'p-dic', code: 'DIC', name: 'Dissolved inorganic carbon' }],
				},
			],
			total: 1,
		});
		getRejectPreview.mockReset().mockResolvedValue({ hold_id: 'hold-2', entries: 1, withdrawn: [] });
		render(PendingVerifications);
		await fireEvent.click(await screen.findByText('intern1@test.local'));
		expect(await screen.findByText(/Released when its inputs are verified: Dissolved inorganic carbon/)).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Verify' })).toBeNull();
	});

	it('says a reject takes nothing else when nothing was computed from the entry', async () => {
		getRejectPreview.mockReset().mockResolvedValue({ hold_id: 'hold-1', entries: 1, withdrawn: [] });
		render(PendingVerifications);
		await fireEvent.click(await screen.findByText('intern1@test.local'));
		expect(await screen.findByText(/Nothing was computed from this entry/)).toBeTruthy();
	});
});
