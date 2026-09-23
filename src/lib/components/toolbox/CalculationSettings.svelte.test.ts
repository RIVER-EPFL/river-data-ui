import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CalculationSettings from './CalculationSettings.svelte';

const updateToolScript = vi.fn(async (_id: string, _body: unknown) => ({}));

vi.mock('$api/service', () => ({
	updateToolScript: (id: string, body: unknown) => updateToolScript(id, body),
}));

const calculation = {
	id: 'calc-1',
	label: 'pCO2',
	description: null,
	enabled: true,
};

describe('CalculationSettings', () => {
	beforeEach(() => updateToolScript.mockClear());

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

	it('does not save an empty label', async () => {
		render(CalculationSettings, { calculation });
		await fireEvent.input(screen.getByLabelText('Label'), { target: { value: '  ' } });
		expect((screen.getByRole('button', { name: 'Save label' }) as HTMLButtonElement).disabled).toBe(true);
	});
});
