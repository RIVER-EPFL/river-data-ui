import { describe, expect, it } from 'vitest';

import { labelFollowingName, newCalculationRequest } from './newCalculation';

describe('new formula calculation', () => {
	it('declares the engine the calculation is, and names no group', () => {
		const made = newCalculationRequest({ name: ' pco2 ', label: 'pCO2' });
		expect(made).toEqual({ request: { name: 'pco2', label: 'pCO2', engine: 'formula' } });
	});

	it('takes the name as the label rather than listing a calculation with none', () => {
		const made = newCalculationRequest({ name: 'pco2', label: '  ' });
		expect(made).toEqual({ request: { name: 'pco2', label: 'pco2', engine: 'formula' } });
	});

	it('declares an R script when that is the engine chosen', () => {
		const made = newCalculationRequest({ name: 'doc', label: 'DOC', engine: 'script' });
		expect(made).toEqual({ request: { name: 'doc', label: 'DOC', engine: 'script' } });
	});

	it('says what is missing instead of posting an incomplete calculation', () => {
		expect(newCalculationRequest({ name: ' ', label: 'x' })).toEqual({
			error: 'A calculation needs a name.',
		});
	});
});

describe('the label while the name is typed', () => {
	it('shows the name so it is not entered twice', () => {
		expect(labelFollowingName({ value: '', edited: false }, 'pco2')).toBe('pco2');
	});

	it('keeps a label somebody typed when the name changes afterwards', () => {
		expect(labelFollowingName({ value: 'pCO2', edited: true }, 'pco2_headspace')).toBe('pCO2');
	});
});
