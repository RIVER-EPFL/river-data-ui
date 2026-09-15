/// What a new formula calculation needs before it can be created, and what the request carries.
///
/// A calculation's engine is a property of the calculation, so it is chosen once here rather than
/// switched afterwards. It names no parameter group: a group organises the grid's columns, and a
/// calculation reads and writes parameters by code (Q169).
export interface NewCalculationInput {
	name: string;
	label: string;
}

export interface NewCalculationRequest {
	name: string;
	label: string;
	engine: 'formula';
}

/**
 * The request the form submits, or the one thing still missing.
 *
 * The label falls back to the name: a calculation with no label reads as its own machine name
 * everywhere it is listed, which is worse than repeating it.
 */
export function newCalculationRequest(
	input: NewCalculationInput,
): { request: NewCalculationRequest } | { error: string } {
	const name = input.name.trim();
	if (!name) return { error: 'A calculation needs a name.' };
	return {
		request: {
			name,
			label: input.label.trim() || name,
			engine: 'formula',
		},
	};
}
