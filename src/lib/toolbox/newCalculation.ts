import type { ToolScriptSummary } from '$api/service';

/// What a new formula calculation needs before it can be created, and what the request carries.
///
/// A calculation's engine is a property of the calculation, so it is chosen once here rather than
/// switched afterwards, and one group holds one calculation (Q43), so a group already bound is not
/// offered again.
export interface NewCalculationInput {
	name: string;
	label: string;
	parameterGroupId: string;
}

export interface NewCalculationRequest {
	name: string;
	label: string;
	engine: 'formula';
	parameter_group_id: string;
}

/** The groups a new formula calculation may be bound to: those no calculation already holds. */
export function unboundGroups<T extends { id: string }>(
	groups: T[],
	scripts: ToolScriptSummary[],
): T[] {
	const taken = new Set(scripts.map((s) => s.parameter_group_id).filter(Boolean));
	return groups.filter((g) => !taken.has(g.id));
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
	if (!input.parameterGroupId) {
		return { error: 'Choose the parameter group whose members this calculation reads and writes.' };
	}
	return {
		request: {
			name,
			label: input.label.trim() || name,
			engine: 'formula',
			parameter_group_id: input.parameterGroupId,
		},
	};
}
