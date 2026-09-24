import type { EventCell } from '$api/service';
import { curveCountLabel } from '$lib/standardCurves';

/**
 * What a cell's declared instrument says about its curves, and where they are: an instrument with
 * no curve corrects nothing, so the declaration has to say so where it is made (Q58). Null for a
 * cell that declares none.
 */
export function instrumentCurves(
	sensorId: string | null | undefined,
	count: number | null,
): { label: string; href: string } | null {
	if (!sensorId) return null;
	return { label: curveCountLabel(count), href: `/sensors/${sensorId}?tab=curves` };
}

/** What the Instrument column of a visit's parameter table says for one row. */
export type RowInstrument =
	| { kind: 'measured'; label: string | null; sensorId: string | null }
	| { kind: 'computed'; calculation: string }
	| { kind: 'entry' };

/**
 * A measured row names the instrument its record says the value was measured on, a computed row
 * the calculation that wrote it, and a row with no reading is left to the next entry's declaration.
 */
export function rowInstrument(cell: EventCell | null): RowInstrument {
	if (cell?.written_by) return { kind: 'computed', calculation: cell.written_by };
	if (!cell || cell.replicates.length === 0) return { kind: 'entry' };
	const sensor = cell.record?.chain.sensor;
	if (!sensor) return { kind: 'measured', label: null, sensorId: null };
	return {
		kind: 'measured',
		label: sensor.name ?? sensor.serial_number ?? sensor.id.slice(0, 8),
		sensorId: sensor.id,
	};
}
