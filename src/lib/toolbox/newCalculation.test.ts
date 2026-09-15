import { describe, expect, it } from 'vitest';

import { newCalculationRequest } from './newCalculation';

describe('new formula calculation', () => {
	it('declares the engine the calculation is, and names no group', () => {
		const made = newCalculationRequest({ name: ' pco2 ', label: 'pCO2' });
		expect(made).toEqual({ request: { name: 'pco2', label: 'pCO2', engine: 'formula' } });
	});

	it('takes the name as the label rather than listing a calculation with none', () => {
		const made = newCalculationRequest({ name: 'pco2', label: '  ' });
		expect(made).toEqual({ request: { name: 'pco2', label: 'pco2', engine: 'formula' } });
	});

	it('says what is missing instead of posting an incomplete calculation', () => {
		expect(newCalculationRequest({ name: ' ', label: 'x' })).toEqual({
			error: 'A calculation needs a name.',
		});
	});
});
