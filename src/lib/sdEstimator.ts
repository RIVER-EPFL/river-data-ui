// The two standard-deviation divisors a replicate group can be served under, and how each is
// named wherever an sd is shown. `sample` divides by n-1, `population` by n; an undeclared slot
// serves sample.
export type SdEstimator = 'sample' | 'population';

export function estimatorLabel(e: SdEstimator | null | undefined): string {
	return e === 'population' ? 'population (divisor n)' : 'sample (divisor n-1)';
}

// The row label beside a standard deviation: which formula produced it, in two words.
export function sdRowLabel(e: SdEstimator | null | undefined): string {
	return e === 'population' ? 'SD (population, n)' : 'SD (sample, n-1)';
}

// The tooltip on a standard deviation computed here: the SQL aggregate and its formula.
export function sdFormulaTitle(e: SdEstimator | null | undefined): string {
	return e === 'population'
		? 'STDDEV_POP: sqrt(Σ(x - x̄)² / n), the population formula this parameter declares'
		: 'STDDEV_SAMP: sqrt(Σ(x - x̄)² / (n - 1)), the sample formula, matching sd() at source';
}
