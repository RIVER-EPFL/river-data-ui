import type { PreviewSlot } from '$lib/parameters/groups';

interface SlotResponse {
	parameter_id: string;
	parameter_code: string;
	role: string;
}

interface ApplyResponse {
	inputs_present: SlotResponse[];
	inputs_missing: SlotResponse[];
	outputs_existing: SlotResponse[];
	outputs_created: SlotResponse[];
}

/** What applying one calculation here would do, read from the route's dry run. */
export interface CalculationApplyPreview {
	inputsPresent: PreviewSlot[];
	/** Reads the site does not measure. Non-empty means the apply is refused. */
	inputsMissing: PreviewSlot[];
	outputsHeld: PreviewSlot[];
	outputsAdding: PreviewSlot[];
	/** Every read is declared here, so Apply has something to do or nothing to fix. */
	applicable: boolean;
	/** Applicable, and every output is already declared: pressing Apply would change nothing. */
	complete: boolean;
}

/**
 * The four lists the panel shows before Apply is pressed. The catalog names the parameters; one
 * the page does not carry reads as its code, which is what the route returned.
 */
export function calculationApplyPreview(
	response: ApplyResponse,
	nameOf: (parameterId: string) => string | null,
): CalculationApplyPreview {
	const line = (slot: SlotResponse): PreviewSlot => ({
		parameterId: slot.parameter_id,
		code: slot.parameter_code,
		name: nameOf(slot.parameter_id) ?? slot.parameter_code,
		role: slot.role,
	});
	const inputsMissing = response.inputs_missing.map(line);
	const outputsAdding = response.outputs_created.map(line);
	return {
		inputsPresent: response.inputs_present.map(line),
		inputsMissing,
		outputsHeld: response.outputs_existing.map(line),
		outputsAdding,
		applicable: inputsMissing.length === 0,
		complete: inputsMissing.length === 0 && outputsAdding.length === 0,
	};
}
