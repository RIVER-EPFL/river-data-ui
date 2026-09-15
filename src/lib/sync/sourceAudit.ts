// Where the source audit's findings are acted on. The audit reports what a source carries that is
// not registered or not paired here; the pairing plan is what registers and pairs it, and the
// streams list is where one row is dealt with on its own.

function streamsHref(base: string, params: Record<string, string>): string {
	const query = new URLSearchParams(params).toString();
	return `${base}/streams?${query}`;
}

/** The plan wizard, landed on the audited source's row. */
export function pairingPlanHref(base: string, sourceSystem: string): string {
	return streamsHref(base, { step: 'source-select', source: sourceSystem });
}

/** The streams list, held to the audited source's unpaired rows. */
export function unpairedStreamsHref(base: string, sourceSystem: string): string {
	return streamsHref(base, { list_filter: 'unpaired', source: sourceSystem });
}
