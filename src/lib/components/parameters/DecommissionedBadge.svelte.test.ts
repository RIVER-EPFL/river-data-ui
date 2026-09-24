import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';

const DecommissionedBadge = (await import('./DecommissionedBadge.svelte')).default;

describe('DecommissionedBadge', () => {
	// Scenario: pCO2 was computed only by a calculation the owner decommissioned.
	// Expected behaviour: the badge says decommissioned, opens that calculation, and names it with
	// the decommission's date.
	it('opens the decommissioned calculation and names it with its date', () => {
		render(DecommissionedBadge, {
			by: { tool_script_id: 'calc-1', calculation: 'pco2', at: '2026-09-24T10:00:00Z' },
		});
		const link = screen.getByRole('link', { name: 'decommissioned' });
		expect(link.getAttribute('href')).toMatch(/\/toolbox\/calc-1$/);
		expect(link.getAttribute('title')).toContain('Computed by pco2, decommissioned on');
		expect(link.getAttribute('title')).toContain('Nothing computes this parameter now');
	});
});
