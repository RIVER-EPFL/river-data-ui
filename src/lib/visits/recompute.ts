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
		label: 'recompute would fix',
		variant: 'warning',
		title: 'Calculated values here are out of date or not computed yet: recompute this visit to fix them.',
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

/** What a calculation's finding says on its chip, and what clears it. */
const CALCULATION_FINDING: Record<string, { label: string; variant: 'warning' | 'muted'; title: string }> = {
	stale_output: {
		label: 'out of date',
		variant: 'warning',
		title: 'The stored value differs from what the calculation gives now. Recompute this visit to fix it.',
	},
	missing_output: {
		label: 'not computed yet',
		variant: 'warning',
		title: 'The inputs are here but no value was written. Recompute this visit to fix it.',
	},
	skipped_output: {
		label: "can't compute: inputs missing",
		variant: 'muted',
		title: 'The calculation could not run here because inputs are missing. Entering them fixes it.',
	},
};

/** The findings a recompute clears, as opposed to a skip, which waits on its inputs. */
const RECOMPUTE_FIXES = new Set(['stale_output', 'missing_output']);

export interface CalculationFindingChip {
	calculation: string;
	kind: string;
	label: string;
	variant: 'warning' | 'muted' | 'alarm';
	title: string;
	/** The parameters carrying the findings, in cell order: the chip opens the first. */
	parameterIds: string[];
}

interface SkipFinding {
	kind: string;
	tool?: string | null;
	reason?: string | null;
	cause?: string | null;
	waits_on?: string | null;
}

/**
 * What a skip says, by what it lacks: its inputs, a step before it, or a fix to its script. A
 * skip served without a cause reads as missing inputs, the commonest.
 */
function skipWording(
	finding: SkipFinding,
	inputs: string[],
): { text: string; variant: CalculationFindingChip['variant']; title: string } {
	const reason = finding.reason ?? '';
	switch (finding.cause) {
		case 'error': {
			const message = reason.replace(/^script error: /, '');
			return {
				text: message ? `failed: ${message}` : 'failed',
				variant: 'alarm',
				title: `The calculation ran and stopped${message ? `: ${message}` : ''}. A recompute stops the same way until the script or the values it reads change.`,
			};
		}
		case 'upstream':
			return {
				text: finding.waits_on ? `waits on ${finding.waits_on}` : 'waits on a step before it',
				variant: 'muted',
				title: `It reads an output ${finding.waits_on ?? 'a step before it'} did not produce here, and runs once that step does.`,
			};
		case 'unknown':
			return {
				text: 'gave no value',
				variant: 'muted',
				title: `The calculation ran and gave no value${reason ? ` (${reason})` : ''}. Check its inputs at this visit.`,
			};
		default:
			return {
				text: CALCULATION_FINDING.skipped_output.label,
				variant: 'muted',
				title:
					inputs.length > 0
						? `The calculation could not run here because inputs are missing: ${inputs.join(', ')}. Entering them fixes it.`
						: CALCULATION_FINDING.skipped_output.title,
			};
	}
}

/**
 * The visit's calculation findings, one chip per calculation and what it says, named by the
 * calculation that raised them. `missingInputs` names the inputs a skipped calculation lacks here.
 */
export function calculationFindings(
	cells: {
		parameter_id: string;
		parameter_code: string;
		written_by?: string | null;
		finding?: SkipFinding | null;
	}[],
	missingInputs: (calculation: string) => string[] = () => [],
): CalculationFindingChip[] {
	const chips = new Map<string, CalculationFindingChip & { text: string }>();
	for (const cell of cells) {
		const finding = cell.finding;
		const plain = finding ? CALCULATION_FINDING[finding.kind] : undefined;
		if (!finding || !plain) continue;
		const calculation = finding.tool ?? cell.written_by ?? cell.parameter_code;
		const wording =
			finding.kind === 'skipped_output'
				? skipWording(finding, missingInputs(calculation))
				: { text: plain.label, variant: plain.variant, title: plain.title };
		const key = `${calculation}|${finding.kind}|${wording.text}`;
		const chip = chips.get(key);
		if (chip) {
			chip.parameterIds.push(cell.parameter_id);
			continue;
		}
		chips.set(key, {
			calculation,
			kind: finding.kind,
			text: wording.text,
			label: '',
			variant: wording.variant,
			title: wording.title,
			parameterIds: [cell.parameter_id],
		});
	}
	return [...chips.values()]
		.map(({ text, ...chip }) => ({ ...chip, label: `${chip.calculation} ${text} (${chip.parameterIds.length})` }))
		.sort((a, b) => a.calculation.localeCompare(b.calculation) || a.kind.localeCompare(b.kind));
}

/** The inputs a calculation reads that hold no served value at the visit, by code. */
export function inputsWithoutValue(
	columns: { parameterId: string; code: string; readBy: string[] }[],
	cells: { parameter_id: string; served_value?: number | null }[],
	calculation: string,
): string[] {
	const valued = new Set(cells.filter((c) => c.served_value != null).map((c) => c.parameter_id));
	return columns
		.filter((c) => c.readBy.includes(calculation) && !valued.has(c.parameterId))
		.map((c) => c.code);
}

/** How many of the visit's findings a recompute would clear, in either shape a cell carries them. */
export function recomputeFixable(
	cells: { finding?: string | { kind: string } | null; finding_count?: number }[],
): number {
	let fixable = 0;
	for (const cell of cells) {
		const kind = typeof cell.finding === 'string' ? cell.finding : cell.finding?.kind;
		if (kind && RECOMPUTE_FIXES.has(kind)) fixable += Math.max(cell.finding_count ?? 1, 1);
	}
	return fixable;
}

/**
 * The visit's calculation chip: a job in flight or failed, else what a recompute would fix. A
 * visit whose only findings are skips carries none, since a recompute changes nothing there.
 */
export function visitCalculationBadge(state: string | undefined, fixable: number): RecomputeBadge | null {
	if (state === 'queued' || state === 'running' || state === 'failed') return RECOMPUTE_BADGE[state];
	if (fixable === 0) return null;
	return {
		label: `Recompute would fix ${fixable}`,
		variant: 'warning',
		title: 'Calculated values here are out of date or not computed yet: Recompute this visit to fix them.',
	};
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
