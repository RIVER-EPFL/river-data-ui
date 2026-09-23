import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import FormulaPalette from './FormulaPalette.svelte';
import type { Constant } from '$api/crud';

const variables = [
	{ name: 'lab_co2', label: 'Lab CO2 (ppm)', category: 'measurement' },
	{ name: 'altitude_m', label: 'altitude_m', category: 'site property' },
];
const constants = [{ name: 'R_gas', value: 8.314, units: 'J/mol/K' }] as Constant[];

describe('FormulaPalette', () => {
	it('hands the picked entry to its caller, whichever kind it is', async () => {
		const onpick = vi.fn();
		render(FormulaPalette, { variables, constants, onpick });

		await userEvent.click(screen.getByTitle(/Lab CO2/));
		expect(onpick).toHaveBeenCalledWith({ kind: 'variable', name: 'lab_co2' });

		await userEvent.click(screen.getByLabelText('Insert * operator'));
		expect(onpick).toHaveBeenCalledWith({ kind: 'operator', op: '*' });
	});

	it('offers a constant under its own section rather than as a variable', async () => {
		const onpick = vi.fn();
		render(FormulaPalette, {
			variables,
			constants: [...constants, ...[]],
			onpick,
		});
		await userEvent.click(screen.getByRole('button', { name: /Constants/ }));
		await userEvent.click(screen.getByTitle(/8.314/));
		expect(onpick).toHaveBeenCalledWith({ kind: 'constant', name: 'R_gas' });
	});

	it('searches by name and by label, and a section with no match is empty', async () => {
		render(FormulaPalette, { variables, constants, onpick: vi.fn() });
		await userEvent.type(screen.getByLabelText('Search the palette'), 'altitude');
		expect(screen.queryByTitle(/Lab CO2/)).toBeNull();
		expect(screen.getByTitle(/altitude_m/)).toBeTruthy();
	});

	it('marks a replicated variable and explains the mark once, below the list', () => {
		render(FormulaPalette, {
			variables: [
				{ ...variables[0]!, replicated: true },
				{ name: 'Field_BP', label: 'Field BP (hPa)', category: 'measurement', replicated: false },
			],
			onpick: vi.fn(),
		});

		const row = (title: RegExp) => screen.getByTitle(title);
		expect(row(/Lab CO2/).querySelector('[aria-label="one value per replicate"]')).not.toBeNull();
		expect(row(/Field BP/).querySelector('[aria-label="one value per replicate"]')).toBeNull();
		expect(screen.getByText('entered or computed once per replicate')).toBeTruthy();
	});

	it('shows no legend when nothing in the list is replicated', () => {
		render(FormulaPalette, { variables, onpick: vi.fn() });
		expect(screen.queryByText('entered or computed once per replicate')).toBeNull();
	});
});
