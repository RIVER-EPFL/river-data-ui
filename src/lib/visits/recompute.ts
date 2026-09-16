// A visit's recompute state as the API reports it, and how a page shows it. The chain runs as a
// tracked job, so a visit whose inputs have just been written says `queued` or `running` until its
// outputs are in the store.

export type RecomputeState = 'current' | 'queued' | 'running' | 'failed' | 'stale';

export type RecomputeBadge = { label: string; variant: 'muted' | 'accent' | 'alarm' | 'warning' };

/** The badge a state shows, or nothing at all for a visit whose calculations are done. */
export const RECOMPUTE_BADGE: Record<string, RecomputeBadge> = {
	queued: { label: 'queued', variant: 'muted' },
	running: { label: 'recomputing', variant: 'accent' },
	failed: { label: 'recompute failed', variant: 'alarm' },
	stale: { label: 'stale', variant: 'warning' },
};

/** Whether the visit's outputs are still being written, so what it reports is not yet its answer. */
export function computing(state: string | undefined): boolean {
	return state === 'queued' || state === 'running';
}

/**
 * The badge a visit carries for its calculations. A portal-synced visit runs none (Q41): its
 * values are the portal's answer and a correction entered here moves no output, so it reads as
 * not calculated rather than as up to date.
 */
export function visitBadge(
	source: string | undefined,
	state: string | undefined
): RecomputeBadge | null {
	if (source === 'portal_sync') return { label: 'not calculated here', variant: 'muted' };
	return RECOMPUTE_BADGE[state ?? ''] ?? null;
}

/** What a person entering a value at a portal-synced visit needs to know before they type it. */
export const SYNCED_VISIT_NOTICE =
	'Calculations do not run at a portal-synced visit: correct the value in the portal.';

/** The notice the entry grid carries for a visit, or nothing when its values are entered here. */
export function entryNoticeFor(source: string | undefined): string | null {
	return source === 'portal_sync' ? SYNCED_VISIT_NOTICE : null;
}

/**
 * Whether a calculation here owns the visit's output rows. A portal-synced visit arrives with the
 * portal's outputs already computed, so naming a local calculation over them claims a run that
 * never happened.
 */
export function computedHere(source: string | undefined): boolean {
	return source !== 'portal_sync';
}

/** How a visit names where its values came from, and who typed them when somebody did. */
export function visitSourceLabel(source: string | undefined, createdBy?: string | null): string {
	if (source === 'portal_sync') return 'Synced from the portal';
	return createdBy ? `Entered manually by ${createdBy}` : 'Entered manually';
}

/** An output a calculation was expected to write, and what the save did to it. */
export interface RunOutput {
	code: string;
	label: string;
	before: number | null;
	after: number | null;
	/** The finding standing on the row afterwards, when the calculation did not write it. */
	finding?: string;
}

/**
 * What the calculations did to the visit, read from the values on each side of the save rather
 * than from the job. An output that moved is the calculation's answer; one that did not, with a
 * finding on its row, is a step that did not run and says why.
 */
export function runOutputs(
	expected: { label: string; outputs: { parameter_code: string }[] }[],
	before: Record<string, number | null | undefined>,
	after: Record<string, number | null | undefined>,
	findings: Record<string, string | undefined> = {},
): RunOutput[] {
	const outputs: RunOutput[] = [];
	for (const calculation of expected) {
		for (const output of calculation.outputs) {
			const code = output.parameter_code;
			outputs.push({
				code,
				label: calculation.label,
				before: before[code] ?? null,
				after: after[code] ?? null,
				...(findings[code] ? { finding: findings[code] } : {}),
			});
		}
	}
	return outputs;
}

/** The outputs whose served value moved, which are the cells the save changed without being typed. */
export function movedOutputs(outputs: RunOutput[]): RunOutput[] {
	return outputs.filter((o) => o.before !== o.after);
}

/**
 * What the action bar says once the calculations have finished: which outputs moved, and which
 * did not with the reason standing on the row. Nothing at all when no calculation was expected.
 */
export function runReportLine(outputs: RunOutput[]): string | null {
	if (outputs.length === 0) return null;
	const moved = movedOutputs(outputs);
	const still = outputs.filter((o) => o.before === o.after);
	const parts: string[] = [];
	if (moved.length > 0) {
		parts.push(
			`${moved.map((o) => `${o.code} ${o.before ?? 'no value'} → ${o.after ?? 'no value'}`).join(', ')}`,
		);
	}
	for (const output of still) {
		parts.push(
			output.finding
				? `${output.code} did not run (${output.finding.replace(/_/g, ' ')})`
				: `${output.code} unchanged`,
		);
	}
	const ran = new Set(moved.map((o) => o.label)).size;
	const head = moved.length > 0 ? `${ran} calculation${ran === 1 ? '' : 's'} ran: ` : 'No output moved: ';
	return `${head}${parts.join('; ')}.`;
}

/**
 * Reads the visits until none is queued or running, so a report after a save is of the run and
 * not of the moment before it. Returns whether the run settled inside the timeout.
 */
export async function readUntilSettled(
	read: () => Promise<{ recompute?: string }[]>,
	{
		intervalMs = 1_000,
		timeoutMs = 60_000,
		wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
	}: { intervalMs?: number; timeoutMs?: number; wait?: (ms: number) => Promise<void> } = {},
): Promise<boolean> {
	let waited = 0;
	for (;;) {
		const visits = await read();
		if (!visits.some((v) => computing(v.recompute))) return true;
		if (waited >= timeoutMs) return false;
		await wait(intervalMs);
		waited += intervalMs;
	}
}
