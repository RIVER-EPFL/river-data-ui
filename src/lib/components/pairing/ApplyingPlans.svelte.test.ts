import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

import type { PairingPlanListing } from '$lib/api/service';

const ApplyingPlans = (await import('./ApplyingPlans.svelte')).default;

function applying(overrides: Partial<PairingPlanListing> = {}): PairingPlanListing {
	return {
		id: 'plan-1',
		source_system: 'cnet',
		status: 'applying',
		created_by: null,
		summary: {} as PairingPlanListing['summary'],
		created_at: new Date().toISOString(),
		applied_at: null,
		version: 3,
		uncovered_streams: null,
		readings_backfilled: 150_000,
		apply_in_flight: false,
		...overrides,
	} as PairingPlanListing;
}

describe('ApplyingPlans', () => {
	it('lists a stalled plan with its committed count and resumes it', async () => {
		const onresume = vi.fn();
		const plan = applying();
		render(ApplyingPlans, { props: { plans: [plan], onresume } });
		expect(screen.getByText('cnet')).not.toBeNull();
		expect(screen.getByText(/150,000 readings of history attributed/)).not.toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
		expect(onresume).toHaveBeenCalledWith(plan);
	});

	it('offers no Resume while an apply job for the plan is in flight', () => {
		render(ApplyingPlans, {
			props: { plans: [applying({ apply_in_flight: true })], onresume: vi.fn() },
		});
		expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
		expect(screen.getByText('Applying…')).not.toBeNull();
	});

	it('offers no Resume for the plan this tab just resumed', () => {
		render(ApplyingPlans, {
			props: { plans: [applying()], resumingId: 'plan-1', onresume: vi.fn() },
		});
		expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
	});
});
