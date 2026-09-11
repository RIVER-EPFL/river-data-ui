import { describe, expect, it } from 'vitest';
import type { DerivedParameter } from '$api/crud';
import { formulaOwnership, formulaShape, fromNum, perReplicateChoices, thresholdPatch, toNum } from './derivedParameters';

const blank = { warningMin: '', warningMax: '', alarmMin: '', alarmMax: '' };

describe('thresholdPatch', () => {
	it('says nothing on a create where the operator typed no threshold', () => {
		expect(thresholdPatch('create', blank)).toBeNull();
	});

	it('writes every field on an edit, so a cleared threshold is cleared', () => {
		expect(thresholdPatch('edit', blank)).toEqual({
			warning_min: null,
			warning_max: null,
			alarm_min: null,
			alarm_max: null,
		});
	});

	it('carries one typed threshold on a create and leaves the rest null', () => {
		expect(thresholdPatch('create', { ...blank, alarmMax: 12 })).toEqual({
			warning_min: null,
			warning_max: null,
			alarm_min: null,
			alarm_max: 12,
		});
	});
});

describe('toNum and fromNum', () => {
	it('round-trips a value and reads blank as absent', () => {
		expect(toNum(fromNum(0))).toBe(0);
		expect(toNum('  ')).toBeNull();
		expect(fromNum(null)).toBe('');
	});
});

describe('formulaOwnership', () => {
	const formula = (id: string, tool_script_id: string | null, ordinal: number) =>
		({ id, tool_script_id, ordinal }) as unknown as DerivedParameter;

	it('leaves a formula authored from the definition list standalone', () => {
		expect(formulaOwnership(null, null, [])).toEqual({ tool_script_id: null, ordinal: 0 });
	});

	it('gives the first formula of a calculation ordinal 1', () => {
		expect(formulaOwnership('calc', null, [])).toEqual({ tool_script_id: 'calc', ordinal: 1 });
	});

	it('takes the next free ordinal, counting only that calculation own formulas', () => {
		const siblings = [formula('a', 'calc', 1), formula('b', 'calc', 4), formula('c', 'other', 9)];
		expect(formulaOwnership('calc', null, siblings)).toEqual({
			tool_script_id: 'calc',
			ordinal: 5,
		});
	});

	it('keeps what an existing definition already says rather than re-deciding it', () => {
		const existing = formula('a', 'calc', 3);
		expect(formulaOwnership('other', existing, [])).toEqual({
			tool_script_id: 'calc',
			ordinal: 3,
		});
	});
});

describe('formula shape', () => {
	it('offers the formula\'s own variables, never the coefficients a curve slot supplies', () => {
		expect(perReplicateChoices(['lab_co2_co2ppm', 'curve_slope', 'Field_BP', 'curve_intercept']))
			.toEqual(['Field_BP', 'lab_co2_co2ppm']);
	});

	it('sends both declarations, and clears either one', () => {
		expect(formulaShape(' lab_co2_co2ppm ', 'doc')).toEqual({
			per_replicate: 'lab_co2_co2ppm',
			curve_slot: 'doc',
			intermediate: false,
		});
		expect(formulaShape('', '  ')).toEqual({
			per_replicate: null,
			curve_slot: null,
			intermediate: false,
		});
		expect(formulaShape('', '', true)).toEqual({
			per_replicate: null,
			curve_slot: null,
			intermediate: true,
		});
	});
});
