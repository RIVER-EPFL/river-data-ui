import type { EventCell, ToolDescriptor } from '$api/service';

/**
 * A numeric field the manifest binds to a measured parameter, typed over on the tool form (B324).
 *
 * The run consumed `value`; the visit holds `stored`, or nothing when the parameter has no
 * reading at that instant. Saving the run saves this alongside the outputs, so the stored output
 * was computed from a value the visit holds.
 */
export interface CorrectionRow {
	/** The manifest param the value was typed into. */
	param: string;
	label: string;
	units: string | null;
	parameterCode: string;
	/** The catalog parameter the visit serves that code as, null when it holds no cell for it. */
	parameterId: string | null;
	value: number;
	stored: number | null;
}

/**
 * The corrections a save of this run carries: one per `event_inputs` param whose entered value is
 * not what the visit holds. A numeric param with no `event_inputs` binding is a run-only setting
 * and never appears here (Q182).
 */
export function correctionRows(
	tool: Pick<ToolDescriptor, 'params' | 'event_inputs'>,
	calcInputs: Record<string, unknown> | null,
	cells: EventCell[],
): CorrectionRow[] {
	const byCode = new Map(cells.map((c) => [c.parameter_code.toLowerCase(), c]));
	const paramByName = new Map(tool.params.map((p) => [p.name, p]));
	const out: CorrectionRow[] = [];
	for (const binding of tool.event_inputs ?? []) {
		const param = paramByName.get(binding.param);
		if (!param || param.kind === 'replicates') continue;
		const value = calcInputs?.[binding.param];
		if (typeof value !== 'number' || !Number.isFinite(value)) continue;
		const cell = byCode.get(binding.parameter_code.toLowerCase());
		const stored = cell?.served_value ?? null;
		if (stored === value) continue;
		out.push({
			param: param.name,
			label: param.label,
			units: param.units,
			parameterCode: binding.parameter_code,
			parameterId: cell?.parameter_id ?? null,
			value,
			stored,
		});
	}
	return out;
}

/** The dialog's one-line account of what a correction changes. */
export function correctionNote(row: CorrectionRow): string {
	const name = row.label || row.parameterCode;
	return row.stored === null
		? `records ${name} ${row.value}, which this visit does not hold`
		: `corrects ${name} ${row.stored} to ${row.value}`;
}
