import type { ExpectedParameter, VisitRow } from '$api/service';

// The Visits table's column set, in the portal's orientation: a date down the left and one column
// group per parameter across. A group is one column holding the served value until it is expanded,
// and then one column per replicate index. The width is the widest group in the listing, so every
// visit in the table shows the same columns and a value stays under its own header.

export interface ParameterColumn {
	parameterId: string;
	code: string;
	name: string;
	units: string | null;
	decimals: number | null;
	/** Replicate columns the group draws: 1 collapsed, its widest replicate count expanded. */
	width: number;
	/** The repeats behind the group, whatever it is drawing. */
	repeats: number;
	expanded: boolean;
	/** The calculation that writes this parameter, when one does. */
	writtenBy: string | null;
	/** The calculations that read this parameter, by name. */
	readBy: string[];
}

/**
 * The replicate columns a parameter draws when it is open: the repeats the widest listed visit
 * holds, or as many as the operator has asked the group for, whichever is larger. Never fewer
 * than one.
 *
 * A repeat is added by the group's plus, not by a spare trailing column (U63), so the asked-for
 * width is the only thing that can carry a column past what is stored.
 */
export function replicateWidth(
	visits: VisitRow[],
	parameterId: string,
	asked: ReadonlyMap<string, number> = new Map(),
): number {
	const stored = visits.reduce((widest, visit) => {
		const cell = visit.cells.find((c) => c.parameter_id === parameterId);
		return Math.max(widest, cell?.replicates?.length ?? 0);
	}, 1);
	return Math.max(stored, asked.get(parameterId) ?? 0);
}

/**
 * Widen or narrow one group by hand. Narrowing stops at the repeats the store holds: dropping a
 * stored value is a withdrawal taken on the visit, not a column taken off the table.
 */
export function askedWidth(
	asked: ReadonlyMap<string, number>,
	visits: VisitRow[],
	parameterId: string,
	count: number,
): Map<string, number> {
	const next = new Map(asked);
	const floor = replicateWidth(visits, parameterId);
	next.set(parameterId, Math.max(floor, count));
	return next;
}

/** The columns the header draws, one entry per parameter, in the order the server sent them. */
export function parameterColumns(
	expected: ExpectedParameter[],
	visits: VisitRow[],
	expanded: ReadonlySet<string>,
	asked: ReadonlyMap<string, number> = new Map(),
): ParameterColumn[] {
	return expected.map((p) => {
		const open = expanded.has(p.parameter_id);
		const repeats = replicateWidth(visits, p.parameter_id, asked);
		return {
			parameterId: p.parameter_id,
			code: p.code,
			name: p.name,
			units: p.units ?? null,
			decimals: p.decimal_places ?? null,
			width: open ? repeats : 1,
			repeats,
			expanded: open,
			writtenBy: p.written_by ?? null,
			readBy: p.read_by ?? [],
		};
	});
}

/**
 * Expanding a parameter that holds one replicate everywhere draws the same single column it drew
 * collapsed, so the click reads as doing nothing. Only a group with repeats to show is expandable.
 */
export function expandable(visits: VisitRow[], parameterId: string): boolean {
	return replicateWidth(visits, parameterId) > 1;
}

export function toggled(expanded: ReadonlySet<string>, parameterId: string): Set<string> {
	const next = new Set(expanded);
	if (!next.delete(parameterId)) next.add(parameterId);
	return next;
}

/** One cell position across the header: a parameter and the replicate index under it. */
export interface GridSlot {
	parameterId: string;
	replicateIndex: number;
	column: ParameterColumn;
}

/**
 * The grid's value columns, left to right: a collapsed group is one slot at its first replicate,
 * an expanded one is a slot per replicate.
 */
export function slotsOf(columns: ParameterColumn[]): GridSlot[] {
	return columns.flatMap((column) =>
		Array.from({ length: column.width }, (_, replicateIndex) => ({
			parameterId: column.parameterId,
			replicateIndex,
			column,
		})),
	);
}

/** The filter value that narrows to one calculation: this prefix and the calculation's tool name. */
export const CALCULATION_FILTER = 'calculation:';

/** Every calculation the columns read or write, once each, in the order the columns first name it. */
export function calculationsOf(columns: ParameterColumn[]): string[] {
	const names = columns.flatMap((c) => [...c.readBy, ...(c.writtenBy ? [c.writtenBy] : [])]);
	return [...new Set(names)];
}

/** One calculation's columns: the inputs it reads, then the outputs it writes. */
export function columnsOfCalculation(columns: ParameterColumn[], tool: string): ParameterColumn[] {
	return [
		...columns.filter((c) => c.readBy.includes(tool)),
		...columns.filter((c) => c.writtenBy === tool && !c.readBy.includes(tool)),
	];
}

/**
 * The columns of one parameter group. `""` is every column; `"none"` is the columns no group
 * claims, which keeps a parameter belonging to nothing reachable rather than filtered out of
 * existence; a `CALCULATION_FILTER` value is one calculation's columns.
 */
export function columnsInGroup(
	columns: ParameterColumn[],
	groupOf: Record<string, string>,
	groupId: string,
): ParameterColumn[] {
	if (groupId === '') return columns;
	if (groupId.startsWith(CALCULATION_FILTER)) {
		return columnsOfCalculation(columns, groupId.slice(CALCULATION_FILTER.length));
	}
	if (groupId === 'none') return columns.filter((c) => !groupOf[c.parameterId]);
	return columns.filter((c) => groupOf[c.parameterId] === groupId);
}
