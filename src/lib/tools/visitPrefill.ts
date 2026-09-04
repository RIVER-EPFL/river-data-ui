import type { EventCell, ToolDescriptor } from '$api/service';

/**
 * A tool form opened on a visit that already holds values (M4).
 *
 * The portal's tool reads the `(station, date, time)` row and renders the stored replicates into
 * the editable tables with the row's standard curve preselected. This is that, computed from the
 * visit's own cells rather than from a tool run, so it works for a portal-synced value, a
 * hand-entered grab and a plain CSV import as well as for a value a tool produced.
 *
 * The result is the `prefill` shape `initFormState` and `curveSelectionsFrom` take, so a caller
 * hands it to the same two functions a "reload into tool" navigation uses.
 */
export function prefillFromVisit(
	tool: ToolDescriptor,
	cells: EventCell[],
): Record<string, unknown> {
	const byCode = new Map<string, EventCell>();
	const byId = new Map<string, EventCell>();
	for (const cell of cells) {
		byCode.set(cell.parameter_code.toLowerCase(), cell);
		byId.set(cell.parameter_id, cell);
	}
	const cellFor = (code?: string | null, id?: string | null): EventCell | undefined =>
		(id ? byId.get(id) : undefined) ?? (code ? byCode.get(code.toLowerCase()) : undefined);

	const prefill: Record<string, unknown> = {};

	// A replicates param is the measurement itself: its stored readings are the rows to open with,
	// in the source's own column order, with a gap left as a repeat that was not measured.
	for (const param of tool.params) {
		if (param.kind !== 'replicates') continue;
		const cell = cellFor(param.parameter_code, param.parameter?.id);
		if (!cell || cell.replicates.length === 0) continue;
		const highest = Math.max(...cell.replicates.map((r) => r.replicate_index));
		const values: (number | null)[] = Array.from({ length: highest + 1 }, () => null);
		for (const replicate of cell.replicates) {
			values[replicate.replicate_index] = replicate.raw_value;
		}
		prefill[param.name] = values;
		// The curve the stored replicates were corrected with, so a correction is one cell rather
		// than a re-pick. Replicates of one group share it; the lowest that names one settles it.
		const curveSlot = param.curve;
		if (curveSlot) {
			const stored = cell.replicates
				.slice()
				.sort((a, b) => a.replicate_index - b.replicate_index)
				.find((r) => r.standard_curve_id)?.standard_curve_id;
			if (stored) prefill[curveSlot] = stored;
		}
	}

	// A scalar the tool reads from the visit: the value the visit serves for that parameter. The
	// server resolves these at calculate time too, so this only puts them on screen.
	for (const input of tool.event_inputs ?? []) {
		if (input.param in prefill) continue;
		const cell = cellFor(input.parameter_code);
		if (cell?.served_value !== undefined && cell.served_value !== null) {
			prefill[input.param] = cell.served_value;
		}
	}

	return prefill;
}

/** Whether opening this tool on the visit would put anything on screen. */
export function hasVisitPrefill(tool: ToolDescriptor, cells: EventCell[]): boolean {
	return Object.keys(prefillFromVisit(tool, cells)).length > 0;
}
