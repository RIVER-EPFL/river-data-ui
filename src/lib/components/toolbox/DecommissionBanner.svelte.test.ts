import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';

import DecommissionBanner from './DecommissionBanner.svelte';

describe('DecommissionBanner', () => {
	it('names who decommissioned the calculation and why', () => {
		render(DecommissionBanner, {
			calculation: {
				decommissioned_at: '2026-09-23T12:00:00Z',
				decommissioned_by: 'evan',
				decommission_reason: 'Replaced by pco2',
			},
		});
		const banner = screen.getByRole('status');
		expect(banner.textContent).toContain('Decommissioned');
		expect(banner.textContent).toContain('by evan');
		expect(banner.textContent).toContain('Replaced by pco2');
	});

	it('shows nothing for a live calculation', () => {
		render(DecommissionBanner, {
			calculation: { decommissioned_at: null, decommissioned_by: null, decommission_reason: null },
		});
		expect(screen.queryByRole('status')).toBeNull();
	});
});
