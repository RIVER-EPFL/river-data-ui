import { describe, expect, it } from 'vitest';
import {
	composedCurve,
	curveIdentity,
	curveOrigin,
	parseCurveForm,
	uniqueCurveName,
	type CurveForm,
} from './standardCurves';

const form = (over: Partial<CurveForm>): CurveForm => ({
	name: 'Plate 7',
	fitted_on: '',
	slope: '2',
	intercept: '1',
	r_squared: '',
	notes: '',
	...over,
});

const curve = (over: Partial<{ id: string; name: string | null; fitted_on: string | null }> = {}) => ({
	id: '0189d3f0-0000-4000-8000-000000000000',
	name: 'DOC plate 4',
	fitted_on: '2021-01-28',
	...over,
});

describe('parseCurveForm', () => {
	// A `type="number"` input binds a number, not the string the type suggests.
	it('accepts the numbers the coefficient inputs bind', () => {
		const parsed = parseCurveForm(form({ slope: 2.5, intercept: -1, r_squared: 0.99 }));
		expect(parsed).toEqual({
			values: {
				name: 'Plate 7',
				fitted_on: null,
				slope: 2.5,
				intercept: -1,
				r_squared: 0.99,
				notes: null,
			},
		});
	});

	it('carries the fit date the operator picked', () => {
		const parsed = parseCurveForm(form({ fitted_on: '2021-01-28' }));
		expect('values' in parsed && parsed.values.fitted_on).toBe('2021-01-28');
	});

	it('refuses a zero slope', () => {
		expect(parseCurveForm(form({ slope: 0 }))).toEqual({
			error: 'Slope cannot be zero: every measurement would produce the same value.',
		});
	});

	it('refuses missing coefficients', () => {
		expect(parseCurveForm(form({ intercept: '' }))).toEqual({
			error: 'Intercept is required and must be a number.',
		});
		expect(parseCurveForm(form({ name: '  ' }))).toEqual({
			error: 'Name is required: the grab-entry picker has nothing else to show.',
		});
	});
});

describe('curveIdentity', () => {
	it('adds the fit date a hand-entered name does not carry', () => {
		expect(curveIdentity(curve())).toBe('DOC plate 4 (fitted 2021-01-28)');
	});

	it('leaves a synced name that already folds the date in alone', () => {
		expect(curveIdentity(curve({ name: 'DOC corr 2021-01-28' }))).toBe('DOC corr 2021-01-28');
	});

	it('falls back to the short id when nothing named the curve', () => {
		expect(curveIdentity(curve({ name: null, fitted_on: null }))).toBe('Curve 0189d3f0');
	});
});

describe('curveOrigin', () => {
	const origin = (over: Partial<{ source_system: string | null; source_key: string | null; copied_from_id: string | null }> = {}) => ({
		source_system: null,
		source_key: null,
		copied_from_id: null,
		...over,
	});

	it('names the source key a replicated curve is identified by', () => {
		expect(curveOrigin(origin({ source_system: 'cnet', source_key: 'standard_curves:17' }))).toBe(
			'standard_curves:17',
		);
	});

	it('falls back to the source system when the key is absent', () => {
		expect(curveOrigin(origin({ source_system: 'cnet' }))).toBe('cnet');
	});

	// A copy holds no source provenance of its own, so without this it reads as hand-entered.
	it('says a copy is a copy', () => {
		expect(curveOrigin(origin({ copied_from_id: '0189d3f0-0000-4000-8000-000000000000' }))).toBe('copy');
	});

	it('says a hand-entered curve is manual', () => {
		expect(curveOrigin(origin())).toBe('manual');
	});
});

describe('composedCurve', () => {
	it('composes the standard curve over the base', () => {
		expect(composedCurve({ slope: 2, intercept: 1 }, { slope: 3, intercept: 0.5 })).toEqual({
			slope: 6,
			intercept: 3.5,
		});
	});
});

describe('uniqueCurveName', () => {
	it('suffixes until the name is free on the instrument', () => {
		expect(uniqueCurveName('Plate 7', [])).toBe('Plate 7 (copy)');
		expect(uniqueCurveName('Plate 7', ['Plate 7 (copy)'])).toBe('Plate 7 (copy 2)');
	});
});
