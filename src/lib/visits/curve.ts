// The standard curve a visit's value was corrected through (Q97), or a calculation computed it
// through (Q268), as the grid names it. Display only: the curve is read off what the cell already
// carries, and the destination follows the calculation badge's split, the calculation for a curve a
// run applied and the lab instrument's curves otherwise.

import type { EventCell, VisitCell } from '$api/service';
import type { CellMarker } from '$lib/visits/cell';
import { curveLabel, formatEquation } from '$lib/standardCurves';

export type CurveTarget =
	| { kind: 'calculation'; tool: string }
	| { kind: 'instrument'; href: string };

export interface CellCurve {
	id: string;
	label: string;
	equation: string;
	retired: boolean;
	target: CurveTarget;
	/** A calculation computed the value through the curve, rather than the curve correcting it. */
	computed: boolean;
}

/**
 * Each distinct curve the cell's readings were corrected through, in replicate order, then each its
 * calculation computed it through, with the coefficients the run used. A value a calculation saved
 * opens that calculation; any other opens the curve on its instrument.
 */
export function cellCurves(
	cell: Pick<EventCell, 'record' | 'tool'> & Partial<Pick<EventCell, 'computed_curves'>>,
	base: string,
): CellCurve[] {
	const readings = [...(cell.record?.readings ?? [])].sort(
		(a, b) => a.replicate_index - b.replicate_index,
	);
	const curves: CellCurve[] = [];
	for (const reading of readings) {
		const curve = reading.standard_curve;
		if (!curve || curves.some((c) => c.id === curve.id)) continue;
		curves.push({
			id: curve.id,
			label: curveLabel({ id: curve.id, name: curve.name ?? null }),
			equation: formatEquation(curve.slope, curve.intercept),
			retired: curve.retired_at != null,
			target: cell.tool
				? { kind: 'calculation', tool: cell.tool }
				: {
						kind: 'instrument',
						href: `${base}/sensors/${curve.sensor_id}?tab=curves&curve=${curve.id}`,
					},
			computed: false,
		});
	}
	for (const curve of cell.computed_curves ?? []) {
		if (!cell.tool || curves.some((c) => c.id === curve.id && c.computed)) continue;
		curves.push({
			id: curve.id,
			label: curveLabel({ id: curve.id, name: curve.name ?? null }),
			equation: formatEquation(curve.slope, curve.intercept),
			retired: false,
			target: { kind: 'calculation', tool: cell.tool },
			computed: true,
		});
	}
	return curves;
}

/**
 * The mark a wide-table cell carries when a curve corrected its value, naming each curve on hover,
 * so which curve a value was made with is read without opening the visit.
 */
export function visitCellCurveMark(cell: Pick<VisitCell, 'curves'>): CellMarker | null {
	const curves = cell.curves ?? [];
	if (!curves.length) return null;
	const names = curves.map((c) => curveLabel({ id: c.id, name: c.name ?? null }));
	return { text: 'c', title: `Corrected with ${names.join(', ')}` };
}

/**
 * The mark a wide-table cell carries when its calculation computed it through a curve, naming each
 * on hover, apart from the curve that corrected a measurement.
 */
export function visitCellComputedCurveMark(
	cell: Partial<Pick<VisitCell, 'computed_curves'>>,
): CellMarker | null {
	const curves = cell.computed_curves ?? [];
	if (!curves.length) return null;
	const names = curves.map((c) => curveLabel({ id: c.id, name: c.name ?? null }));
	return { text: 'f', title: `Computed with ${names.join(', ')}` };
}
