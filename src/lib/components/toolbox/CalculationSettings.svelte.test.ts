import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CalculationSettings from './CalculationSettings.svelte';

const updateToolScript = vi.fn(async (_id: string, _body: unknown) => ({}));
const decommissionToolScript = vi.fn(async (_id: string, _reason: string) => ({}));
const recommissionToolScript = vi.fn(async (_id: string, _reason: string) => ({
	calculation: { name: 'pco2' },
	name_restored: true,
}));
const listCommissions = vi.fn(async (_id: string): Promise<unknown[]> => []);
const getCalculationSites = vi.fn(async () => [
	{
		calculation_id: 'calc-1',
		calculation: 'pco2',
		sites: [
			{ id: 's1', name: 'FP1' },
			{ id: 's2', name: 'FP2' },
		],
	},
]);

vi.mock('$api/service', () => ({
	updateToolScript: (id: string, body: unknown) => updateToolScript(id, body),
	decommissionToolScript: (id: string, reason: string) => decommissionToolScript(id, reason),
	recommissionToolScript: (id: string, reason: string) => recommissionToolScript(id, reason),
	listCommissions: (id: string) => listCommissions(id),
	getCalculationSites: () => getCalculationSites(),
}));

const admin = { value: true };
vi.mock('$auth/me.svelte', () => ({
	me: { can: (cap: string) => cap !== 'admin' || admin.value },
}));

const calculation = {
	id: 'calc-1',
	label: 'pCO2',
	description: null,
	enabled: true,
};

describe('CalculationSettings', () => {
	beforeEach(() => {
		updateToolScript.mockClear();
		decommissionToolScript.mockClear();
		recommissionToolScript.mockClear();
		listCommissions.mockClear();
		admin.value = true;
	});

	it('saves the label and description it is given', async () => {
		const onsaved = vi.fn();
		render(CalculationSettings, { calculation, onsaved });
		await fireEvent.input(screen.getByLabelText('Label'), { target: { value: 'pCO2 headspace' } });
		await fireEvent.input(screen.getByLabelText('Description'), {
			target: { value: 'From the syringe headspace' },
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Save label' }));
		await waitFor(() => expect(onsaved).toHaveBeenCalled());
		expect(updateToolScript).toHaveBeenCalledWith('calc-1', {
			label: 'pCO2 headspace',
			description: 'From the syringe headspace',
		});
	});

	it('switches the calculation off and on through the same route', async () => {
		const onsaved = vi.fn();
		render(CalculationSettings, { calculation, onsaved });
		await fireEvent.click(screen.getByRole('checkbox'));
		await waitFor(() => expect(onsaved).toHaveBeenCalled());
		expect(updateToolScript).toHaveBeenCalledWith('calc-1', { enabled: false });
	});

	it('decommissions with a reason, having said how many sites it stops at', async () => {
		const onsaved = vi.fn();
		render(CalculationSettings, { calculation, onsaved });
		await fireEvent.click(screen.getByRole('button', { name: 'Decommission' }));
		expect(await screen.findByText(/the 2 sites it is active at/)).toBeTruthy();
		const confirm = screen.getAllByRole('button', { name: 'Decommission' }).at(-1) as HTMLButtonElement;
		expect(confirm.disabled).toBe(true);
		await fireEvent.input(screen.getByLabelText('Reason'), { target: { value: 'Superseded by pco2_v2' } });
		await fireEvent.click(confirm);
		await waitFor(() => expect(onsaved).toHaveBeenCalled());
		expect(decommissionToolScript).toHaveBeenCalledWith('calc-1', 'Superseded by pco2_v2');
	});

	it('offers no decommission to a non-administrator', () => {
		admin.value = false;
		render(CalculationSettings, { calculation });
		expect(screen.queryByRole('button', { name: 'Decommission' })).toBeNull();
	});

	it('offers a recommission in place of the decommission once a calculation is decommissioned', async () => {
		const onsaved = vi.fn();
		listCommissions.mockResolvedValueOnce([
			{ event: 'decommissioned', name: 'pco2', actor: 'admin', at: '2026-09-23T12:00:00Z', reason: 'a slip' },
		]);
		render(CalculationSettings, {
			calculation: { ...calculation, enabled: false, decommissioned_at: '2026-09-23T12:00:00Z' },
			onsaved,
		});
		expect(screen.queryByRole('button', { name: 'Decommission' })).toBeNull();
		expect(await screen.findByText(/Decommissioned by admin, as pco2: a slip/)).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Recommission' }));
		const confirm = screen.getAllByRole('button', { name: 'Recommission' }).at(-1) as HTMLButtonElement;
		expect(confirm.disabled).toBe(true);
		await fireEvent.input(screen.getByLabelText('Reason'), { target: { value: 'decommissioned by mistake' } });
		await fireEvent.click(confirm);
		await waitFor(() => expect(onsaved).toHaveBeenCalled());
		expect(recommissionToolScript).toHaveBeenCalledWith('calc-1', 'decommissioned by mistake');
		expect(decommissionToolScript).not.toHaveBeenCalled();
	});

	it('does not save an empty label', async () => {
		render(CalculationSettings, { calculation });
		await fireEvent.input(screen.getByLabelText('Label'), { target: { value: '  ' } });
		expect((screen.getByRole('button', { name: 'Save label' }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('offers no switch for a decommissioned calculation', () => {
		render(CalculationSettings, {
			calculation: { ...calculation, enabled: false, decommissioned_at: '2026-09-23T12:00:00Z' },
		});
		expect(screen.queryByRole('checkbox')).toBeNull();
	});
});
