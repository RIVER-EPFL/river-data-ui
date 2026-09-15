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

/** A command row as the audit reads it: the service that answered, and what it answered with. */
export interface AnsweredCommand {
	service_id: string;
	command: string;
	status: string;
	completed_at: string | null;
	result: Record<string, unknown> | null;
}

/**
 * The last audit a service answered, so the report stands on the page without the service being
 * reachable. The rows carry the result the command was answered with; the newest completed one is
 * what the source looked like when it was last asked.
 */
export function latestSourceAudit<T extends AnsweredCommand>(
	commands: T[],
	serviceId: string,
): { report: Record<string, unknown>; answeredAt: string } | null {
	const answered = commands
		.filter(
			(c) =>
				c.service_id === serviceId &&
				c.command === 'source_audit' &&
				c.status === 'completed' &&
				c.completed_at !== null &&
				c.result !== null,
		)
		.sort((a, b) => (a.completed_at! < b.completed_at! ? 1 : -1));
	const last = answered[0];
	return last ? { report: last.result!, answeredAt: last.completed_at! } : null;
}
