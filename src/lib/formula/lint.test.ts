import { describe, expect, it } from 'vitest';

import { callAt, completionsFor, lintFormula, nearest } from './lint';

const known = {
	variables: ['Dissolved_O2', 'WTW_Temp_degC_1', 'Field_BP'],
	constants: ['lab_temp_avg_degC'],
	steps: ['bp'],
};

describe('formula lint', () => {
	it('names an unknown identifier and offers the nearest one, before the API does', () => {
		const [first, ...rest] = lintFormula('Dissolved_Oxygen * 2', known);
		expect(rest).toEqual([]);
		expect(first).toMatchObject({
			kind: 'unknown_identifier',
			name: 'Dissolved_Oxygen',
			suggestion: 'Dissolved_O2',
		});
	});

	it('takes a parameter, a constant and an earlier step as things a formula may read', () => {
		expect(lintFormula('Dissolved_O2 + lab_temp_avg_degC + bp', known)).toEqual([]);
	});

	it('offers nothing where nothing is near, rather than a wrong guess', () => {
		expect(nearest('q', ['Dissolved_O2', 'Field_BP'])).toBeUndefined();
	});

	it('reports an unbalanced parenthesis and stops reading past it', () => {
		expect(lintFormula('round(Dissolved_O2', known)).toEqual([
			{ kind: 'unbalanced_parenthesis', message: '1 parenthesis is not closed' },
		]);
		expect(lintFormula('Dissolved_O2)', known)[0]?.kind).toBe('unbalanced_parenthesis');
	});

	it('counts a function\'s arguments, and leaves the variadic ones alone', () => {
		expect(lintFormula('if(gt(Dissolved_O2, 1), 2)', known)).toEqual([
			{
				kind: 'wrong_argument_count',
				name: 'if',
				message: 'if takes 3 arguments, 2 given',
			},
		]);
		expect(lintFormula('max(Dissolved_O2, Field_BP, 1)', known)).toEqual([]);
		expect(lintFormula('round()', known)[0]?.message).toBe('round takes 1 argument, 0 given');
	});

	it('refuses a formula that names its own output', () => {
		expect(lintFormula('co2 * 2', { ...known, variables: ['co2'], ownCode: 'co2' })).toEqual([
			{
				kind: 'self_reference',
				name: 'co2',
				message: "'co2' is this formula's own output; a formula cannot read what it writes",
			},
		]);
	});

	it('says which call the caret is in and which argument it is on', () => {
		const text = 'if(gt(Dissolved_O2, 1), 2, 3)';
		expect(callAt(text, text.indexOf('Dissolved_O2'))).toEqual({
			name: 'gt',
			arity: 2,
			argument: 0,
		});
		expect(callAt(text, text.length - 2)).toEqual({ name: 'if', arity: 3, argument: 2 });
		expect(callAt('Dissolved_O2 * 2', 4)).toBeNull();
	});

	it('completes the author\'s own names before the language\'s', () => {
		expect(completionsFor('Fie', known)).toEqual(['Field_BP']);
		expect(completionsFor('co', known)).toEqual(['cos', 'cosh', 'coalesce']);
		// The curve coefficients are offered only where a slot binds them.
		expect(completionsFor('curve', known)).toEqual([]);
		expect(completionsFor('curve', { ...known, hasCurve: true })).toEqual([
			'curve_slope',
			'curve_intercept',
		]);
	});
});
