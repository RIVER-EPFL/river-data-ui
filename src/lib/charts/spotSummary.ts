// What a spot point's replicate statistics say, in the two forms the chart needs: the mark to
// draw and the line to print. A single measurement, a replicated group whose replicates agree and
// a replicated group with spread are three different statements about the same slot, so each gets
// its own glyph and its own sentence rather than sharing the bare diamond.

import type { SpotPointStats } from './spotMarkers';
import { formatMeasurement } from '$lib/format';

/** What the slot declares about the numbers being printed. */
export interface SpotSummaryContext {
	units?: string | null;
}

/** How much dispersion a group carries, which is what decides its mark. */
export type SpotDispersion = 'single' | 'agreed' | 'spread';

/**
 * `single` is one measurement, `agreed` two or more that produced no spread (a stored sd of zero,
 * or none stored at all), `spread` a group with an sd to draw.
 */
export function spotDispersion(stat: SpotPointStats | undefined | null): SpotDispersion {
	if (!stat || stat.n < 2) return 'single';
	return stat.stdev != null && stat.stdev > 0 ? 'spread' : 'agreed';
}

/**
 * The tooltip's sample line. Every spot point gets one, including a single measurement: without it
 * a lone grab is indistinguishable from a logger point.
 */
export function spotSampleLine(
	stat: SpotPointStats | undefined | null,
	decimals: number | null | undefined,
	context: SpotSummaryContext = {},
): string | null {
	if (!stat) return null;
	const all = stat.replicates ?? [];
	if (spotDispersion(stat) === 'single' && all.length <= 1) return 'single measurement, no replicates';

	const reps = all
		.map(
			(r) =>
				formatMeasurement(r.calibrated_value ?? r.raw_value, decimals) +
				(r.withdrawn ? '†' : r.flagged ? '*' : '')
		)
		.join(', ');
	const sd =
		stat.stdev != null && stat.stdev > 0
			? ` ±${formatMeasurement(stat.stdev, decimals)}${context.units ? ` ${context.units}` : ''} SD`
			: '';
	// The listing shows every stored replicate, the mean counts only the ones that survive
	// curation, so the excluded ones are named rather than left to an unexplained mark against a
	// count that does not add up.
	const flagged = all.filter((r) => r.flagged && !r.withdrawn).length;
	const withdrawn = all.filter((r) => r.withdrawn).length;
	const excluded = [
		flagged ? `${flagged} of ${all.length} flagged*` : '',
		withdrawn ? `${withdrawn} withdrawn†` : '',
	]
		.filter(Boolean)
		.join(', ');

	let line = reps ? `mean of ${stat.n}${sd}: ${reps}` : `mean of ${stat.n} replicates${sd}`;
	if (spotDispersion(stat) === 'agreed') line += ' (replicates agree, sd 0)';
	const range = spotRangeLabel(stat, decimals);
	if (range) line += `, ${range}`;
	if (excluded) line += ` (${excluded})`;
	return line;
}

/**
 * The observed extremes of a group, as text. The bar is one standard deviation, so its caps sit at
 * values no replicate need hold; the range is what was actually measured and is reported as
 * numbers rather than drawn as a competing mark.
 */
export function spotRangeLabel(
	stat: SpotPointStats | undefined | null,
	decimals: number | null | undefined,
): string | null {
	if (!stat || stat.n < 2 || stat.min == null || stat.max == null) return null;
	return `range ${formatMeasurement(stat.min, decimals)} to ${formatMeasurement(stat.max, decimals)}`;
}
