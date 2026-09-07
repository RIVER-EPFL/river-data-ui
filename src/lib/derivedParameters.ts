import type { DerivedParameter } from '$api/crud';

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

/**
 * The bounds to write onto the output parameter's global `alarm_thresholds` row, or null when there
 * is nothing to say. A create leaves the thresholds alone unless the operator typed one, because
 * reaching the output parameter at all costs a re-fetch of the definition the after-create hook
 * filled in; an edit always writes, so clearing a field clears the bound.
 */
export function thresholdPatch(
	mode: 'create' | 'edit',
	form: ThresholdForm,
): ThresholdPatch | null {
	const patch = {
		warning_min: toNum(form.warningMin),
		warning_max: toNum(form.warningMax),
		alarm_min: toNum(form.alarmMin),
		alarm_max: toNum(form.alarmMax),
	};
	if (mode === 'edit') return patch;
	return Object.values(patch).some((v) => v !== null) ? patch : null;
}

/** What a formula's create or update body carries, beyond its own text. */
export interface FormulaOwnership {
	tool_script_id: string | null;
	ordinal: number;
}

/**
 * The calculation a formula being authored belongs to, and where it sits in that calculation's
 * order. A formula authored from a calculation takes the next free ordinal in it; one authored
 * from the definition list belongs to no calculation and is standalone, which is the per-reading
 * continuous kind. An edit keeps what the definition already says rather than re-deciding it.
 */
export function formulaOwnership(
	calculationId: string | null,
	existing: DerivedParameter | null,
	siblings: DerivedParameter[],
): FormulaOwnership {
	if (existing) {
		return { tool_script_id: existing.tool_script_id, ordinal: existing.ordinal };
	}
	if (!calculationId) return { tool_script_id: null, ordinal: 0 };
	const taken = siblings
		.filter((f) => f.tool_script_id === calculationId)
		.map((f) => f.ordinal);
	return { tool_script_id: calculationId, ordinal: taken.length === 0 ? 1 : Math.max(...taken) + 1 };
}
