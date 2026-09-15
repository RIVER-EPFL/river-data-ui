import type { Parameter, ParameterGroupMember } from '$api/crud';

/// What a parameter's group membership says about it. A calculation belongs to no group (Q169),
/// so both facts are read per parameter: the member row of whichever group holds it.

/** What the source computed a column with, as its pairing plan recorded it. */
export interface PortalReference {
	code: string;
	function: string;
	inputs: string[];
}

function codesById(parameters: Parameter[]): Map<string, string> {
	return new Map(parameters.map((p) => [p.id, p.code]));
}

/** The catalog codes entered several times at a visit: every member row carrying a replicate spec. */
export function replicatedCodes(
	members: ParameterGroupMember[],
	parameters: Parameter[],
): string[] {
	const codes = codesById(parameters);
	return members
		.filter((m) => m.replicates)
		.map((m) => codes.get(m.parameter_id))
		.filter((code): code is string => !!code);
}

/** What the source computed each of `named` with, for the ones a member row declares. */
export function portalReference(
	members: ParameterGroupMember[],
	parameters: Parameter[],
	named: string[],
): PortalReference[] {
	const codes = codesById(parameters);
	const wanted = new Set(named.map((c) => c.toLowerCase()));
	return members
		.flatMap((m) => {
			const code = codes.get(m.parameter_id);
			if (!code || !wanted.has(code.toLowerCase())) return [];
			const declared = m.source_calculation as { function?: string; inputs?: string[] } | null;
			if (!declared?.function) return [];
			return [{ code, function: declared.function, inputs: declared.inputs ?? [] }];
		})
		.sort((a, b) => a.code.localeCompare(b.code));
}
