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

/// Which computation a link opens, and on which cell of it. `cell` is the formula's code, `run`
/// the stored run (or, for a continuous value, the decision) that produced the value, and `index`
/// the replicate the reader came from. Together they name one historical result rather than the
/// calculation in the abstract.
export interface ComputationAnchor {
	cell?: string | null;
	run?: string | null;
	index?: number | null;
}

/// The editor of the thing a computed value names: its calculation when the formula belongs to one,
/// the standalone derived parameter otherwise. `at` opens it on the value the reader came from.
export function calculationHref(
	base: string,
	calc: { definition_id: string; tool_script_id?: string | null },
	at: ComputationAnchor = {},
): string {
	const href = calc.tool_script_id
		? toolboxHref(base, calc.tool_script_id)
		: `${base}/derived/${encodeURIComponent(calc.definition_id)}`;
	const query = new URLSearchParams();
	if (at.cell) query.set('cell', at.cell);
	if (at.run) query.set('run', at.run);
	if (at.index != null) query.set('index', String(at.index));
	const suffix = query.toString();
	if (!suffix) return href;
	return `${href}${href.includes('?') ? '&' : '?'}${suffix}`;
}
