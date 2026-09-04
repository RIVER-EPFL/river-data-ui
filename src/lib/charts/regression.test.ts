import { describe, expect, it } from 'vitest';
import { linearRegression } from './regression';

describe('linearRegression', () => {
	it('recovers an exact line', () => {
		const r = linearRegression([0, 1, 2, 3], [1, 3, 5, 7]);
		expect(r).not.toBeNull();
		expect(r!.slope).toBeCloseTo(2, 12);
		expect(r!.intercept).toBeCloseTo(1, 12);
		expect(r!.rSquared).toBeCloseTo(1, 12);
		expect(r!.n).toBe(4);
	});

	it('returns null below two points', () => {
		expect(linearRegression([], [])).toBeNull();
		expect(linearRegression([1], [2])).toBeNull();
	});

	it('returns null when every x is the same, the slope being undefined', () => {
		expect(linearRegression([5, 5, 5], [1, 2, 3])).toBeNull();
	});

	it('reports zero r-squared for a flat y, where total variance is zero', () => {
		const r = linearRegression([1, 2, 3], [4, 4, 4]);
		expect(r!.slope).toBeCloseTo(0, 12);
		expect(r!.rSquared).toBe(0);
	});
});
