import type { ToolScriptSummary } from '$api/service';

/// One calculation's page, whatever engine it runs on. `key` is its id or its name: a stored
/// provenance blob and a tool descriptor name a calculation, they do not carry its id.
export function toolboxHref(base: string, key: string, version?: number | null): string {
	const href = `${base}/toolbox/${encodeURIComponent(key)}`;
	return version != null ? `${href}?version=${version}` : href;
}

/// The calculation a `/toolbox/[id]` segment names, matched by id first and then by name.
export function findCalculation(
	scripts: ToolScriptSummary[],
	key: string,
): ToolScriptSummary | null {
	return scripts.find((s) => s.id === key) ?? scripts.find((s) => s.name === key) ?? null;
}

/// The editor of the thing a computed value names: its calculation when the formula belongs to one,
/// the standalone derived parameter otherwise.
export function calculationHref(
	base: string,
	calc: { definition_id: string; tool_script_id?: string | null },
): string {
	return calc.tool_script_id
		? toolboxHref(base, calc.tool_script_id)
		: `${base}/derived/${encodeURIComponent(calc.definition_id)}`;
}
