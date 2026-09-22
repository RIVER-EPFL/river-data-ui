import { describe, expect, it } from 'vitest';

import {
	MAX_COMPLETIONS,
	applyCompletion,
	callAt,
	completionsFor,
	identifierAt,
	lintFormula,
	nearest,
} from './lint';

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

	it('names the text the expression does not reach, which the server refuses as a parse error', () => {
		expect(lintFormula('Dissolved_O2 Dissolved_O2', known)).toEqual([
			{
				kind: 'trailing_text',
				message: "the expression ends before 'Dissolved_O2': an operator is missing between them",
			},
		]);
		// An identifier it cannot read is named as one, not as trailing text.
		expect(lintFormula('Dissolved_O2 + nope', known)[0]?.kind).toBe('unknown_identifier');
		expect(lintFormula('round(Dissolved_O2) * Field_BP', known)).toEqual([]);
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
		expect(completionsFor('Fie', known).map((c) => c.name)).toEqual(['Field_BP']);
		expect(completionsFor('co', known).map((c) => c.name).slice(0, 3)).toEqual([
			'cos',
			'cosh',
			'coalesce',
		]);
		// The curve coefficients are offered only where a slot binds them.
		expect(completionsFor('curve', known).map((c) => c.name)).toEqual([]);
		expect(completionsFor('curve', { ...known, hasCurve: true }).map((c) => c.name)).toEqual([
			'curve_slope',
			'curve_intercept',
		]);
	});

	it('says where each name it offers comes from', () => {
		expect(completionsFor('bp', known).slice(0, 2)).toEqual([
			{ name: 'bp', kind: 'step' },
			{ name: 'Field_BP', kind: 'parameter', label: undefined },
		]);
		expect(completionsFor('lab', known)).toEqual([{ name: 'lab_temp_avg_degC', kind: 'constant' }]);
	});

	it('offers every parameter a shared prefix names', () => {
		const headspace = {
			variables: ['hs_co2_ppm', 'hs_h2o_pct', 'Field_BP'],
		};
		expect(completionsFor('hs_', headspace).map((c) => c.name)).toEqual([
			'hs_co2_ppm',
			'hs_h2o_pct',
		]);
	});

	it('ranks a prefix over a run of letters, and a run over a misspelling', () => {
		const names = { variables: ['Temp_degC', 'WTW_Temp_degC_1', 'Tmp'] };
		expect(completionsFor('temp', names).map((c) => c.name)).toEqual([
			'Temp_degC',
			'WTW_Temp_degC_1',
			'Tmp',
		]);
	});

	it('finds a parameter by its label when the code says nothing', () => {
		const labelled = {
			variables: ['DOC_ppb'],
			labels: { DOC_ppb: 'Dissolved organic carbon' },
		};
		expect(completionsFor('dissolved', labelled).map((c) => c.name)).toEqual(['DOC_ppb']);
	});

	it('offers at most one screenful', () => {
		const many = { variables: Array.from({ length: 40 }, (_, i) => `param_${i}`) };
		expect(completionsFor('param', many)).toHaveLength(MAX_COMPLETIONS);
	});

	it('reads the identifier the caret is in the middle of, and nothing after an operator', () => {
		expect(identifierAt('hs_co2 * 2', 3)).toEqual({ prefix: 'hs_', start: 0, end: 6 });
		expect(identifierAt('hs_co2 * ', 9)).toBeNull();
		expect(identifierAt('2 * 3', 5)).toBeNull();
	});

	it('replaces the whole identifier the caret is in, not the part typed so far', () => {
		expect(applyCompletion('hs_co * 2', 5, 'hs_co2_ppm')).toEqual({
			text: 'hs_co2_ppm * 2',
			caret: 10,
		});
		expect(applyCompletion('hs_c2 * 2', 4, 'hs_co2_ppm')).toEqual({
			text: 'hs_co2_ppm * 2',
			caret: 10,
		});
	});
});
