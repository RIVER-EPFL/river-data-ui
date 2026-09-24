// A visit's recompute state as the API reports it, and how a page shows it. The chain runs as a
// tracked job, so a visit whose inputs have just been written says `queued` or `running` until its
// outputs are in the store.

export type RecomputeState = 'current' | 'queued' | 'running' | 'failed' | 'stale';

export type RecomputeBadge = {
	label: string;
	variant: 'muted' | 'accent' | 'alarm' | 'warning';
	/** What the badge means and what to do about it, carried as the chip's hover text. */
	title: string;
};

/** The badge a state shows, or nothing at all for a visit whose calculations are done. */
export const RECOMPUTE_BADGE: Record<string, RecomputeBadge> = {
	queued: {
		label: 'queued',
		variant: 'muted',
		title: 'The calculations are queued: this visit\'s outputs are not written yet.',
	},
	running: {
		label: 'recomputing',
		variant: 'accent',
		title: 'The calculations are running: this visit\'s outputs are not written yet.',
	},
	failed: {
		label: 'recompute failed',
		variant: 'alarm',
		title: 'The recompute failed: its run is under Jobs on the System page.',
	},
	stale: {
		label: 'stale',
		variant: 'warning',
		title: 'An input moved after the outputs were written: recompute this visit.',
	},
};

/** Whether the visit's outputs are still being written, so what it reports is not yet its answer. */
export function computing(state: string | undefined): boolean {
	return state === 'queued' || state === 'running';
}

/** The badge a visit carries for its calculations, whatever its source (Q259). */
export function visitBadge(state: string | undefined): RecomputeBadge | null {
	return RECOMPUTE_BADGE[state ?? ''] ?? null;
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
 * The served payload as text when it differs from the one held, else null: a poll that brings back
 * what is already on screen reloads nothing.
 */
export function changedPayload(held: string | null, served: unknown): string | null {
	const text = JSON.stringify(served);
	return text === held ? null : text;
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
