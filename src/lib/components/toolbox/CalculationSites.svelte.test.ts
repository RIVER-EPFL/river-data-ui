import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CalculationSites from './CalculationSites.svelte';

const applied = { sites: [{ id: 's1', name: 'FP1' }] };
const getCalculationSites = vi.fn(async () => [
	{ calculation_id: 'calc-1', calculation: 'suva', sites: applied.sites },
]);
const applyCalculationAtSite = vi.fn(async (siteId: string, _calculationId: string, dryRun = false) => {
	if (!dryRun) applied.sites = [...applied.sites, { id: siteId, name: 'FP2' }];
	return {
		inputs_present: [{ parameter_id: 'p-doc', parameter_code: 'doc', role: 'input' }],
		inputs_missing: [],
		outputs_existing: [],
		outputs_created: siteId === 's2' ? [{ parameter_id: 'p-suva', parameter_code: 'suva', role: 'output' }] : [],
	};
});

vi.mock('$api/service', () => ({
	getCalculationSites: () => getCalculationSites(),
	listTools: async () => [{ name: 'suva' }],
	listToolScripts: async () => [],
	applyCalculationAtSite: (siteId: string, calculationId: string, dryRun?: boolean) =>
		applyCalculationAtSite(siteId, calculationId, dryRun),
}));

vi.mock('$api/crud', () => ({
	api: { sites: {}, parameters: { list: async () => ({ data: [] }) } },
}));

vi.mock('$api/paged', () => ({
	listAll: async () => [
		{ id: 's2', name: 'FP2' },
		{ id: 's1', name: 'FP1' },
	],
}));

// Scenario: an author on a calculation's page applies it at another site (Q274).
//
// Expected behaviour: the page names the sites the Toolbox reads, offers every site to apply at,
// and after Apply names the new one too.
describe('CalculationSites', () => {
	beforeEach(() => {
		applied.sites = [{ id: 's1', name: 'FP1' }];
		applyCalculationAtSite.mockClear();
	});

	it('names the sites the calculation is applied at, and applies it at a chosen one', async () => {
		render(CalculationSites, { id: 'calc-1', name: 'suva' });
		await waitFor(() => expect(screen.getByRole('link', { name: 'FP1' })).toBeTruthy());

		const site = screen.getByLabelText('Site') as HTMLSelectElement;
		await waitFor(() => expect(site.options.length).toBe(3));
		await fireEvent.change(site, { target: { value: 's2' } });
		await waitFor(() => expect(applyCalculationAtSite).toHaveBeenCalledWith('s2', 'calc-1', true));
		const apply = screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement;
		await waitFor(() => expect(apply.disabled).toBe(false));
		await fireEvent.click(apply);

		await waitFor(() => expect(applyCalculationAtSite).toHaveBeenCalledWith('s2', 'calc-1', undefined));
		await waitFor(() => expect(screen.getByRole('link', { name: 'FP2' })).toBeTruthy());
		expect(screen.queryByLabelText('Calculation')).toBeNull();
	});
});
