import { describe, expect, it } from 'vitest';
import { fromNum, perReplicateChoices, toNum } from './derivedParameters';

describe('toNum and fromNum', () => {
	it('round-trips a value and reads blank as absent', () => {
		expect(toNum(fromNum(0))).toBe(0);
		expect(toNum('  ')).toBeNull();
		expect(fromNum(null)).toBe('');
	});
});

describe('perReplicateChoices', () => {
	it('offers the formula\'s own variables, never the coefficients a curve slot supplies', () => {
		expect(perReplicateChoices(['lab_co2_co2ppm', 'curve_slope', 'Field_BP', 'curve_intercept']))
			.toEqual(['Field_BP', 'lab_co2_co2ppm']);
	});
});
