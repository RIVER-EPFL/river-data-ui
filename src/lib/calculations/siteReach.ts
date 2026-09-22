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
