import { describe, expect, it } from 'vitest';

import { estimatorLabel, sdFormulaTitle, sdRowLabel } from './sdEstimator';

describe('sd estimator labels', () => {
	it('names the population formula for a population-declared group and not the sample one', () => {
		const title = sdFormulaTitle('population');
		expect(title).toContain('STDDEV_POP');
		expect(title).not.toContain('STDDEV_SAMP');
		expect(sdRowLabel('population')).toBe('SD (population, n)');
		expect(estimatorLabel('population')).toBe('population (divisor n)');
	});

	it('reads an undeclared group as the sample formula, which is what it was computed with', () => {
		expect(sdFormulaTitle(null)).toContain('STDDEV_SAMP');
		expect(sdFormulaTitle(undefined)).toContain('n - 1');
		expect(sdRowLabel('sample')).toBe('SD (sample, n-1)');
	});
});
