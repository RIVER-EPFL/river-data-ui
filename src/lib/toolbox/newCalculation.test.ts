import { describe, expect, it } from 'vitest';

import type { ToolScriptSummary } from '$api/service';
import { newCalculationRequest, unboundGroups } from './newCalculation';

const script = (over: Partial<ToolScriptSummary>) => over as ToolScriptSummary;

describe('new formula calculation', () => {
	it('declares the engine the calculation is, and the group it reads', () => {
		const made = newCalculationRequest({
			name: ' pco2 ',
			label: 'pCO2',
			parameterGroupId: 'group-1',
		});
		expect(made).toEqual({
			request: { name: 'pco2', label: 'pCO2', engine: 'formula', parameter_group_id: 'group-1' },
		});
	});

	it('takes the name as the label rather than listing a calculation with none', () => {
		const made = newCalculationRequest({ name: 'pco2', label: '  ', parameterGroupId: 'g' });
		expect(made).toEqual({
			request: { name: 'pco2', label: 'pco2', engine: 'formula', parameter_group_id: 'g' },
		});
	});

	it('says what is missing instead of posting an incomplete calculation', () => {
		expect(newCalculationRequest({ name: ' ', label: 'x', parameterGroupId: 'g' })).toEqual({
			error: 'A calculation needs a name.',
		});
		expect(newCalculationRequest({ name: 'pco2', label: '', parameterGroupId: '' })).toEqual({
			error: 'Choose the parameter group whose members this calculation reads and writes.',
		});
	});

	it('offers only the groups no calculation already holds', () => {
		const groups = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
		const scripts = [
			script({ parameter_group_id: 'b' }),
			script({ parameter_group_id: null }),
		];
		expect(unboundGroups(groups, scripts)).toEqual([{ id: 'a' }, { id: 'c' }]);
	});
});
