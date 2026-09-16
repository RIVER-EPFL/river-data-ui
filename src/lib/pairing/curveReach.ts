import type { PlanCurveAssignment } from '$api/service';

type Reach = Pick<
	PlanCurveAssignment,
	'corrected_parameters' | 'corrected_sites' | 'first_corrected' | 'last_corrected' | 'reading_count'
>;

function month(iso: string): string {
	return new Date(iso).toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function list(items: string[]): string {
	return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** What a curve corrects, in data terms: "corrects DOC at 6 stations, Apr 2023 to Jan 2024". */
export function curveReachLine(c: Reach): string {
	if (c.reading_count === 0 || !c.first_corrected || !c.last_corrected) return 'corrects no readings yet';
	const first = month(c.first_corrected);
	const last = month(c.last_corrected);
	const period = first === last ? first : `${first} to ${last}`;
	if (c.corrected_parameters.length === 0) return `corrects readings outside this plan, ${period}`;
	const sites = c.corrected_sites;
	const where = sites.length === 1 ? sites[0] : `${sites.length} stations`;
	return `corrects ${list(c.corrected_parameters)} at ${where}, ${period}`;
}
