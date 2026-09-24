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
	const stored = storedWidths(visits).get(parameterId) ?? 1;
	return Math.max(stored, asked.get(parameterId) ?? 0);
}

const WIDTHS = new WeakMap<VisitRow[], Map<string, number>>();

/** Each parameter's widest stored replicate group over a listing, by the highest index held, built
 * once per listing. */
export function storedWidths(visits: VisitRow[]): Map<string, number> {
	let widths = WIDTHS.get(visits);
	if (widths) return widths;
	widths = new Map();
	for (const visit of visits) {
		for (const cell of visit.cells) {
			// Replicates are addressed by index, and two streams may hold the same one.
			const width = (cell.replicates ?? []).reduce((w, r) => Math.max(w, r.replicate_index + 1), 1);
			widths.set(cell.parameter_id, Math.max(widths.get(cell.parameter_id) ?? 1, width));
		}
	}
	WIDTHS.set(visits, widths);
	return widths;
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

/**
 * Every calculation applied at the site, once each, in the order the columns first name it. A
 * calculation is applied where the site holds one of its outputs; one that only reads a column
 * here computes nothing here.
 */
export function calculationsOf(columns: ParameterColumn[]): string[] {
	return [...new Set(columns.flatMap((c) => (c.writtenBy ? [c.writtenBy] : [])))];
}

/** One calculation's columns: the outputs it writes, then the inputs it reads. */
export function columnsOfCalculation(columns: ParameterColumn[], tool: string): ParameterColumn[] {
	return [
		...columns.filter((c) => c.writtenBy === tool),
		...columns.filter((c) => c.readBy.includes(tool) && c.writtenBy !== tool),
	];
}

/**
 * The columns of one parameter group. `""` is every column; `"none"` is the columns no group
 * claims, which keeps a parameter belonging to nothing reachable rather than filtered out of
 * existence; a `CALCULATION_FILTER` value is one calculation's columns, and `NOT_CALCULATED` the
 * columns none touches.
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
	if (groupId === NOT_CALCULATED) return uncalculated(columns);
	if (groupId === 'none') return columns.filter((c) => !groupOf[c.parameterId]);
	return columns.filter((c) => groupOf[c.parameterId] === groupId);
}

/** The filter value for the columns no calculation applied at the site reads or writes. */
export const NOT_CALCULATED = 'uncalculated';

/** How the header gathers the columns: in code order, under their parameter group, or under each calculation. */
export type ColumnGrouping = 'alphabetical' | 'group' | 'calculation';

export const COLUMN_GROUPINGS: { value: ColumnGrouping; label: string }[] = [
	{ value: 'alphabetical', label: 'A to Z' },
	{ value: 'group', label: 'Parameter group' },
	{ value: 'calculation', label: 'Calculation' },
];

/** One cell of the header row over the parameters: its label, the filter a click sets, and its columns. */
export interface ColumnBand {
	label: string;
	filter: string;
	columns: ParameterColumn[];
}

const byCode = (a: ParameterColumn, b: ParameterColumn) => a.code.localeCompare(b.code);

/**
 * The columns gathered under the header row. A to Z is one unlabelled band in code order. By
 * parameter group, each group in its label order, then "Ungrouped". By calculation, each
 * calculation applied at the site with its outputs then its inputs, so a column several of them
 * read stands under each, then "Not calculated".
 */
export function columnBands(
	columns: ParameterColumn[],
	grouping: ColumnGrouping,
	groupOf: Record<string, string>,
	groupLabels: Record<string, string>,
	calculationLabel: (tool: string) => string = (tool) => tool,
): ColumnBand[] {
	if (grouping === 'alphabetical') return [{ label: '', filter: '', columns: [...columns].sort(byCode) }];
	const bands: ColumnBand[] = [];
	if (grouping === 'group') {
		const ids = [...new Set(columns.map((c) => groupOf[c.parameterId]).filter(Boolean))];
		const label = (id: string) => groupLabels[id] ?? id;
		for (const id of ids.sort((a, b) => label(a).localeCompare(label(b)))) {
			bands.push({
				label: label(id),
				filter: id,
				columns: columns.filter((c) => groupOf[c.parameterId] === id).sort(byCode),
			});
		}
		const rest = columns.filter((c) => !groupOf[c.parameterId]).sort(byCode);
		if (rest.length > 0) bands.push({ label: 'Ungrouped', filter: 'none', columns: rest });
		return bands;
	}
	const tools = calculationsOf(columns).sort((a, b) =>
		calculationLabel(a).localeCompare(calculationLabel(b)),
	);
	for (const tool of tools) {
		bands.push({
			label: calculationLabel(tool),
			filter: `${CALCULATION_FILTER}${tool}`,
			columns: [
				...columns.filter((c) => c.writtenBy === tool).sort(byCode),
				...columns.filter((c) => c.readBy.includes(tool) && c.writtenBy !== tool).sort(byCode),
			],
		});
	}
	const rest = uncalculated(columns).sort(byCode);
	if (rest.length > 0) bands.push({ label: 'Not calculated', filter: NOT_CALCULATED, columns: rest });
	return bands;
}

function uncalculated(columns: ParameterColumn[]): ParameterColumn[] {
	const applied = new Set(calculationsOf(columns));
	return columns.filter((c) => !c.writtenBy && !c.readBy.some((tool) => applied.has(tool)));
}

/**
 * The bands the grid draws under a filter. A filter naming one of the bands draws that band alone;
 * any other narrows the columns and gathers what is left.
 */
export function shownBands(
	columns: ParameterColumn[],
	grouping: ColumnGrouping,
	groupOf: Record<string, string>,
	groupLabels: Record<string, string>,
	filter: string,
	calculationLabel?: (tool: string) => string,
): ColumnBand[] {
	const all = columnBands(columns, grouping, groupOf, groupLabels, calculationLabel);
	if (filter === '') return all;
	const named = all.find((b) => b.filter === filter);
	if (named) return [named];
	return columnBands(columnsInGroup(columns, groupOf, filter), grouping, groupOf, groupLabels, calculationLabel);
}
