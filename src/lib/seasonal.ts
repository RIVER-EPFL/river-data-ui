import type { SeasonalFinding } from '$api/service';

// How a seasonal check reads on a save panel. The gate itself is the server's: a save naming a
// check is held to exactly the values that check screened.

export const SEASONAL_CLASS_LABELS: Record<string, string> = {
	no_history: 'no history',
	below_min: 'below recorded minimum',
	below_q10: 'below Q10',
	normal: 'normal',
	above_q90: 'above Q90',
	above_max: 'above recorded maximum',
};

/** One finding as a line: the parameter, how the value classified, and the range it was read against. */
export function seasonalFindingLabel(finding: SeasonalFinding, parameterName: string): string {
	const range =
		finding.min !== null && finding.max !== null
			? ` (seasonal range ${finding.min.toPrecision(4)} – ${finding.max.toPrecision(4)}, n=${finding.n})`
			: '';
	return `${parameterName}: ${SEASONAL_CLASS_LABELS[finding.class] ?? finding.class}${range}`;
}
