import type { Parameter, ParameterGroupMember } from '$api/crud';

/// What a parameter's group membership says about it. A calculation belongs to no group (Q169),
/// so both facts are read per parameter: the member row of whichever group holds it.

/** What the source computed a column with, as its pairing plan recorded it. */
export interface PortalReference {
	code: string;
	function: string;
	inputs: string[];
	sourceSystem: string | null;
	column: string | null;
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
			const declared = m.source_calculation;
			if (!declared?.function) return [];
			return [
				{
					code,
					function: declared.function,
					inputs: declared.inputs ?? [],
					sourceSystem: declared.source_system ?? null,
					column: declared.column ?? null,
				},
			];
		})
		.sort((a, b) => a.code.localeCompare(b.code));
}

const REPLICATE_STATISTICS: Record<string, string> = {
	calcMean: 'mean',
	calcSd: 'standard deviation',
};

function listed(columns: string[]): string {
	if (columns.length < 2) return columns.join('');
	return `${columns.slice(0, -1).join(', ')} and ${columns.at(-1)}`;
}

/** Whether the recorded function is only the portal's statistic over its replicate columns. */
export function isReplicateStatistic(recorded: PortalReference): boolean {
	return recorded.function in REPLICATE_STATISTICS;
}

/** A recorded portal calculation as it reads in the reference pane: the portal's replicate
 *  statistics said as such, anything else as the call the portal made. */
export function referenceText(recorded: PortalReference): string {
	const statistic = REPLICATE_STATISTICS[recorded.function];
	if (statistic) return `the portal's ${statistic} of its ${listed(recorded.inputs)} columns`;
	return `${recorded.function}(${recorded.inputs.join(', ')})`;
}

/** Where the portal stored the value: its system and its own column, as far as the plan recorded
 *  them. */
export function referenceOrigin(recorded: PortalReference): string | null {
	const system = recorded.sourceSystem?.toUpperCase();
	const column = recorded.column ? `column ${recorded.column}` : null;
	return [system, column].filter(Boolean).join(' ') || null;
}
