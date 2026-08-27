import type { StandardCurve } from '$api/crud';

/**
 * Shared rules for standard curves. The label, equation, validation and name-collision handling live
 * here so the instrument tab, the copy dialog and the grab-entry picker all state them the same way.
 */

/** Display name; `name` is nullable in the database, so fall back to a short id. */
export function curveLabel(curve: Pick<StandardCurve, 'id' | 'name'>): string {
	return curve.name?.trim() || `Curve ${curve.id.slice(0, 8)}`;
}

/** Renders "y = 2x + 1" / "y = 0.9x - 0.1"; a negative intercept becomes a subtraction. */
export function formatEquation(slope: number, intercept: number): string {
	const sign = intercept < 0 ? '-' : '+';
	return `y = ${slope}x ${sign} ${Math.abs(intercept)}`;
}

export function curveEquation(curve: Pick<StandardCurve, 'slope' | 'intercept'>): string {
	return formatEquation(curve.slope, curve.intercept);
}

export interface Coefficients {
	slope: number;
	intercept: number;
}

/**
 * The single curve a reading's corrections amount to: the standard curve applied on top of the
 * base, which composes to one line because both are linear. `null` when neither applies, matching
 * the server storing no corrected value in that case.
 */
export function composedCurve(
	base: Coefficients | null,
	standard: Coefficients | null,
): Coefficients | null {
	if (!base && !standard) return null;
	if (!standard) return { slope: base!.slope, intercept: base!.intercept };
	if (!base) return { slope: standard.slope, intercept: standard.intercept };
	return {
		slope: standard.slope * base.slope,
		intercept: standard.slope * base.intercept + standard.intercept,
	};
}

/** Free-text fields the operator types, before validation. */
export interface CurveForm {
	name: string;
	slope: string;
	intercept: string;
	r_squared: string;
	notes: string;
}

export const emptyCurveForm: CurveForm = { name: '', slope: '', intercept: '', r_squared: '', notes: '' };

export interface CurveValues {
	name: string;
	slope: number;
	intercept: number;
	r_squared: number | null;
	notes: string | null;
}

/**
 * Validate what the operator typed. Name is required here although the column is nullable, because
 * the grab-entry picker has nothing else to identify a curve by. A zero slope is rejected client
 * side for the same reason the API rejects it: every measurement would come out the same value.
 */
export function parseCurveForm(form: CurveForm): { values: CurveValues } | { error: string } {
	const name = form.name.trim();
	if (!name) return { error: 'Name is required: the grab-entry picker has nothing else to show.' };

	const slope = Number(form.slope);
	if (!form.slope.trim() || Number.isNaN(slope)) return { error: 'Slope is required and must be a number.' };
	if (slope === 0) return { error: 'Slope cannot be zero: every measurement would produce the same value.' };

	const intercept = Number(form.intercept);
	if (!form.intercept.trim() || Number.isNaN(intercept)) return { error: 'Intercept is required and must be a number.' };

	let r_squared: number | null = null;
	if (form.r_squared.trim()) {
		r_squared = Number(form.r_squared);
		if (Number.isNaN(r_squared)) return { error: 'R² must be a number.' };
	}

	return { values: { name, slope, intercept, r_squared, notes: form.notes.trim() || null } };
}

/**
 * A name free on this instrument. Nothing in the database forbids two curves sharing a name, but a
 * duplicate leaves the grab-entry picker ambiguous, so a copy is suffixed until it is distinct.
 */
export function uniqueCurveName(base: string, taken: Iterable<string>, suffix = 'copy'): string {
	const used = new Set(taken);
	const first = `${base} (${suffix})`;
	if (!used.has(first)) return first;
	let n = 2;
	while (used.has(`${base} (${suffix} ${n})`)) n += 1;
	return `${base} (${suffix} ${n})`;
}

/** The API's refusals carry their explanation in the body; surface it rather than a status code. */
export function apiMessage(e: unknown): string {
	const raw = e instanceof Error ? e.message : String(e);
	try {
		const parsed: unknown = JSON.parse(raw);
		if (parsed && typeof parsed === 'object') {
			const rec = parsed as Record<string, unknown>;
			for (const key of ['error', 'message', 'detail']) {
				if (typeof rec[key] === 'string') return rec[key];
			}
		}
	} catch {
		// Plain-text body, which is the usual shape.
	}
	return raw;
}
