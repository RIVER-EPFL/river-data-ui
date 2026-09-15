// The states the tool results bar renders: what a save would re-run, and where the seasonal check
// stands against the values on screen.

/** Where the seasonal gate stands: nothing screened, these values screened, or screened and stale. */
export type CheckState = 'unchecked' | 'checked' | 'stale';

/**
 * A check covers the exact values it screened, so a signature that has moved since is no longer an
 * answer about what would be written.
 */
export function checkState(
	checkedSignature: string | null,
	currentSignature: string,
): CheckState {
	if (checkedSignature === null) return 'unchecked';
	return checkedSignature === currentSignature ? 'checked' : 'stale';
}

/** Whether a save of these values may proceed. */
export function checkSatisfied(state: CheckState): boolean {
	return state === 'checked';
}

/** What the bar says a save would re-run, or null when it would re-run nothing. */
export function consequenceLine(
	calculations: { label: string; outputs: { parameter_code: string }[] }[],
): string | null {
	if (calculations.length === 0) return null;
	const parts = calculations.map((c) => {
		const outputs = c.outputs.map((o) => o.parameter_code);
		return outputs.length > 0 ? `${c.label} (${outputs.join(', ')})` : c.label;
	});
	const n = calculations.length;
	return `Saving re-runs ${n} calculation${n === 1 ? '' : 's'} at this visit: ${parts.join('; ')}.`;
}
