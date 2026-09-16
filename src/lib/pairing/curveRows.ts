import type { PlanCurveAssignment, PlanHeldCurve, PlanInstruments } from '$api/service';

/// One row of the plan's Curves tab: a curve the source holds until an instrument is chosen for
/// it, or one already stored on an instrument. Either is reviewed once, and the plan records the
/// key like a project's or a parameter's.
export type CurveRow =
	| { kind: 'held'; key: string; curve: PlanHeldCurve; reviewed: boolean }
	| { kind: 'stored'; key: string; curve: PlanCurveAssignment; reviewed: boolean };

/** The review key for one curve, by the id the plan's instrument view lists it under. */
export function curveKey(id: string): string {
	return `curve:${id}`;
}

/** Held curves first, since they block the apply, then the stored ones. */
export function curveRows(
	planInstruments: PlanInstruments | null,
	reviewedKeys: Iterable<string> = [],
): CurveRow[] {
	if (!planInstruments) return [];
	const reviewed = new Set(reviewedKeys);
	const held = planInstruments.held_curves.map((curve): CurveRow => {
		const key = curveKey(curve.id);
		return { kind: 'held', key, curve, reviewed: reviewed.has(key) };
	});
	const stored = planInstruments.curves.map((curve): CurveRow => {
		const key = curveKey(curve.id);
		return { kind: 'stored', key, curve, reviewed: reviewed.has(key) };
	});
	return [...held, ...stored];
}

/** Why a curve cannot be reviewed yet, or null. A held curve is reviewed on an instrument. */
export function curveReviewBlocked(row: CurveRow): string | null {
	return row.kind === 'held' && !row.curve.attached ? 'Attach it to an instrument first' : null;
}

/** The name the row shows: the curve's own, else the source's label for a held one. */
export function curveTitle(row: CurveRow): string {
	if (row.curve.name) return row.curve.name;
	return row.kind === 'held' ? row.curve.label : row.curve.id;
}
