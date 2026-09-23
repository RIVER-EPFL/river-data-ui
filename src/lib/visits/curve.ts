// The standard curve a visit's value was corrected through, as the grid names it (Q97). Display
// only: the curve is read off the record the cell already carries, and the destination follows the
// calculation badge's split, the calculation for a curve a run applied and the lab instrument's
// curves otherwise.

import type { EventCell } from '$api/service';
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
}

/**
 * Each distinct curve the cell's readings were corrected through, in replicate order. A value a
 * calculation saved opens that calculation; any other opens the curve on its instrument.
 */
export function cellCurves(cell: Pick<EventCell, 'record' | 'tool'>, base: string): CellCurve[] {
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
		});
	}
	return curves;
}
