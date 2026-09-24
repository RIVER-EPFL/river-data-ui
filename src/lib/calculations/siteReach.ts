/** A site as the calculation page offers it: how much of what the set reads it measures. */
export interface Reach {
	id: string;
	name: string;
	/** Parameters of the set this site measures. */
	measured: number;
	/** Parameters the set reads from a site at all. */
	total: number;
}

/**
 * The sites to offer a calculation, the ones measuring most of what it reads first and then by
 * name. A site whose parameters are not known counts as measuring everything, which is what the
 * catalog has not loaded yet.
 */
export function rankByReach(
	sites: Array<{ id: string; name: string; availableParamNames?: string[] }>,
	reads: string[],
): Reach[] {
	const wanted = [...new Set(reads)];
	return sites
		.map((s) => ({
			id: s.id,
			name: s.name,
			measured: s.availableParamNames
				? wanted.filter((r) => s.availableParamNames!.includes(r)).length
				: wanted.length,
			total: wanted.length,
		}))
		.sort((a, b) => b.measured - a.measured || a.name.localeCompare(b.name));
}

/** What the picker says after a site's name, or '' when the set reads nothing from a site. */
export function reachNote(reach: Reach): string {
	if (reach.total === 0) return '';
	return reach.measured === reach.total
		? `measures all ${reach.total}`
		: `measures ${reach.measured} of ${reach.total}`;
}

/** The sites a calculation can run at: those measuring everything it reads, in reach order. */
export function fullReach(reaches: Reach[]): Reach[] {
	return reaches.filter((r) => r.measured === r.total);
}

/** A site's count of the visits holding every input the set requires. */
export interface VisitCount {
	site_id: string;
	visits: number;
}

/** A site as the picker offers it, with what it says after the name. */
export interface SiteChoice {
	id: string;
	name: string;
	note: string;
}

/**
 * The sites to offer a calculation: those with a visit it can run at, most such visits first. A set
 * that also draws over a site's streams (`series`) can run where no visit holds its inputs, so the
 * other sites declaring them follow. Without `counts` (the set requires nothing of a visit, or the
 * counts have not arrived) it is the declaring sites.
 */
export function offeredSites(
	sites: Array<{ id: string; name: string }>,
	declaring: Reach[],
	counts: VisitCount[] | null,
	series: boolean,
): SiteChoice[] {
	if (!counts) return declaring.map((r) => ({ id: r.id, name: r.name, note: reachNote(r) }));
	const names = new Map(sites.map((s) => [s.id, s.name]));
	const withVisits = counts
		.filter((c) => names.has(c.site_id))
		.sort((a, b) => b.visits - a.visits || names.get(a.site_id)!.localeCompare(names.get(b.site_id)!))
		.map((c) => ({
			id: c.site_id,
			name: names.get(c.site_id)!,
			note: c.visits === 1 ? '1 visit' : `${c.visits} visits`,
		}));
	if (!series) return withVisits;
	const listed = new Set(withVisits.map((c) => c.id));
	return [
		...withVisits,
		...declaring
			.filter((r) => !listed.has(r.id))
			.map((r) => ({ id: r.id, name: r.name, note: 'no visit holds every input' })),
	];
}

/** A parameter at a site as the span reads it. */
interface Extent {
	code: string;
	data_start: string | null;
	data_end: string | null;
}

/**
 * The span the read parameters cover at a site, from the earliest start to the latest end, or
 * null when none of them holds data there.
 */
export function readSpan(extents: Extent[], reads: string[]): { start: string; end: string } | null {
	const wanted = new Set(reads);
	let lo = Number.POSITIVE_INFINITY;
	let hi = Number.NEGATIVE_INFINITY;
	for (const e of extents) {
		if (!wanted.has(e.code) || !e.data_start || !e.data_end) continue;
		lo = Math.min(lo, new Date(e.data_start).getTime());
		hi = Math.max(hi, new Date(e.data_end).getTime());
	}
	if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
	return { start: new Date(lo).toISOString(), end: new Date(hi).toISOString() };
}
