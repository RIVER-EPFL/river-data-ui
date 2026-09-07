import { describe, expect, it } from 'vitest';
import { fromNum, thresholdPatch, toNum } from './derivedParameters';

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
