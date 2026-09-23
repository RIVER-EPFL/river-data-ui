/** The four bounds as the number inputs bind them; `bind:value` on `type="number"` yields a number
 *  as soon as anything is typed, so each is read as text. */
export interface ThresholdForm {
	warningMin: string | number;
	warningMax: string | number;
	alarmMin: string | number;
	alarmMax: string | number;
}

export interface ThresholdPatch {
	warning_min: number | null;
	warning_max: number | null;
	alarm_min: number | null;
	alarm_max: number | null;
}

export const toNum = (v: string | number): number | null => {
	const s = String(v ?? '').trim();
	return s === '' ? null : Number(s);
};

export const fromNum = (n: number | null | undefined): string => (n == null ? '' : String(n));

/// The variables a formula may be evaluated per replicate over.
///
/// A formula runs over one input's replicate vector, so the choice is among the variables the
/// formula itself names. The curve coefficients are supplied by the curve slot rather than read
/// from a parameter, so neither is a replicate to iterate.
export function perReplicateChoices(variableNames: string[]): string[] {
	return variableNames
		.filter((n) => n !== 'curve_slope' && n !== 'curve_intercept')
		.sort((a, b) => a.localeCompare(b));
}

