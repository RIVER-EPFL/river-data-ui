/// What a new calculation needs before it can be created, and what the request carries.
///
/// A calculation's engine is a property of the calculation, so it is chosen once here rather than
/// switched afterwards. It names no parameter group: a group organises the grid's columns, and a
/// calculation reads and writes parameters by code (Q169).
export type CalculationEngine = 'formula' | 'script';

export interface NewCalculationInput {
	name: string;
	label: string;
	engine?: CalculationEngine;
}

export interface NewCalculationRequest {
	name: string;
	label: string;
	engine: CalculationEngine;
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
			engine: input.engine ?? 'formula',
		},
	};
}

/**
 * What the label field holds while the name is being typed: the name itself until somebody
 * types a label of their own, and what they typed from then on.
 */
export function labelFollowingName(label: { value: string; edited: boolean }, name: string): string {
	return label.edited ? label.value : name;
}
