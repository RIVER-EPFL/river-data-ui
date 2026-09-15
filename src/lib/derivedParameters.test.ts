import { describe, expect, it } from 'vitest';
import type { DerivedParameter } from '$api/crud';
import { formulaOwnership, formulaReads, formulaShape, fromNum, perReplicateChoices, thresholdPatch, toNum } from './derivedParameters';

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
		expect(formulaOwnership(null)).toEqual({ tool_script_id: null, ordinal: 0 });
	});

	it('keeps what an existing definition already says rather than re-deciding it', () => {
		expect(formulaOwnership(formula('a', 'calc', 3))).toEqual({
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

describe('formulaReads', () => {
	it('leaves out every name the language defines', () => {
		expect(formulaReads('coalesce(lab_temp, na) + 273.15', [])).toEqual(['lab_temp']);
		expect(formulaReads('if(gt(Depth, 0), ln(Depth), na)', [])).toEqual(['Depth']);
	});

	it('leaves out a declared constant and keeps a step', () => {
		expect(formulaReads('CO2_HS_Um * Rgas', ['Rgas'])).toEqual(['CO2_HS_Um']);
	});
});
