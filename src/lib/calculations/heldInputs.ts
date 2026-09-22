import type { DerivedParameterSource } from '$api/crud';

/** A source read by holding the last value measured at or before the instant computed (Q230). */
const HOLD = 'hold';

/** The variables a stored formula holds between visits, in the order its sources are listed. */
export function heldOf(sources: DerivedParameterSource[] | undefined): string[] {
	return (sources ?? []).filter((s) => s.alignment === HOLD).map((s) => s.variable_name);
}

/** Every variable the set holds, named once, in the order the formulas read them. */
export function heldInSet(formulas: Array<{ held?: string[] }>): string[] {
	return [...new Set(formulas.flatMap((f) => f.held ?? []))];
}

/**
 * What the author is told before the save, or '' when the set holds nothing. A held input is
 * measured at a visit and stands at every instant until the next visit measures a new one, so a
 * set that publishes on a stream carries one number between visits.
 */
export function holdWarning(held: string[]): string {
	if (held.length === 0) return '';
	const names = held.join(', ');
	const it = held.length === 1 ? 'it' : 'them';
	return `${names} ${held.length === 1 ? 'is held' : 'are held'} between visits: every value this calculation computes carries the number last measured for ${it}, until the next visit measures a new one.`;
}

/**
 * Whether the set may hold this row between visits (Q230): a parameter it reads as one value per
 * visit. A constant, a site property and a curve's coefficients are the same at every instant, a
 * step and an output are computed rather than read, a statistic summarises what a run produced,
 * and a replicate family is outside what the rule was decided over.
 */
export function holdable(row: { band: string; code: string | null } | null | undefined): boolean {
	return row?.band === 'single' && row.code === null;
}
