/** The visit a new entry stages: a station and the instant its values were collected at. */
export function newEntryRequest(
	siteId: string,
	collectedAt: string,
): { request: { site_id: string; collected_at: string } } | { error: string } {
	if (!siteId) return { error: 'Choose a station' };
	if (!collectedAt) return { error: 'Choose a date' };
	return { request: { site_id: siteId, collected_at: collectedAt } };
}

/** The data entry page, carrying whatever query a link to the retired `/tools` route named. */
export function dataEntryHref(base: string, search: string): string {
	return `${base}/data-entry${search}`;
}

/** Data entry reopened on the run a tool-run provenance blob names, or null when it names none. */
export function reopenRunHref(base: string, provenance: Record<string, unknown>): string | null {
	const tool = provenance.tool;
	const runId = provenance.run_id;
	if (typeof tool !== 'string' || !tool || typeof runId !== 'string' || !runId) return null;
	return `${base}/data-entry?tool=${encodeURIComponent(tool)}&reload=${encodeURIComponent(runId)}`;
}
