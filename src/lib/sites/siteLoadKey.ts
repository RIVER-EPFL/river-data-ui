/**
 * Page-local UI state: the chosen tab, the expanded visit and its record, and the open point record
 * (`point`, `t`, `mt`). Changing one of these changes what is shown, not which site is loaded.
 */
const PAGE_LOCAL_PARAMS = ['tab', 'event', 'parameter', 'point', 't', 'mt'];

/** The site view a URL asks for. Two URLs with the same key describe the same fetch. */
export function siteLoadKey(siteId: string, search: string): string {
	const params = new URLSearchParams(search);
	for (const name of PAGE_LOCAL_PARAMS) params.delete(name);
	params.sort();
	return `${siteId}|${params.toString()}`;
}
