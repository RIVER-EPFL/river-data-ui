// The Toolbox's one row per calculation: every `tool_scripts` row, with the per-output rows it
// produces folded under it. A versionless R script serves no output and still has a row.

import type { CalculationSites, ToolScriptSummary } from '$api/service';
import type { CalculationEngine, CalculationInput, CalculationRow } from '$lib/calculations/rows';
import { toolboxHref } from '$lib/toolbox/route';

export interface CalculationEntry {
	/** The calculation's name, as a finding and a scoped recompute name it. */
	calculation: string;
	/** The `tool_scripts` row its label is saved to. Null for a row with no script. */
	id: string | null;
	label: string;
	engine: CalculationEngine;
	href: string;
	/** Its outputs, one per parameter it writes, in output-code order. */
	outputs: CalculationRow[];
	/** Every input any of its outputs reads, once each by code. */
	inputs: CalculationInput[];
	fires_on: string;
	/** Readings stored under its outputs, summed. Null when no output has coverage. */
	stored: number | null;
	/** An R script with no active version, which is why it has no outputs. */
	versionless: boolean;
	/** The sites the chain fires it at, by name. Null when it fires nowhere. */
	sites: CalculationSites['sites'] | null;
	/** When it was decommissioned, null while it is live. */
	decommissioned_at: string | null;
}

const FIRES_ON: Record<CalculationEngine, string> = {
	formula: 'each source reading',
	script: 'each write at a visit',
};

function engineOf(script: ToolScriptSummary): CalculationEngine {
	return script.engine === 'formula' ? 'formula' : 'script';
}

function mergedInputs(outputs: CalculationRow[]): CalculationInput[] {
	const byCode = new Map<string, CalculationInput>();
	for (const input of outputs.flatMap((o) => o.inputs)) {
		const key = input.code.toLowerCase();
		if (!byCode.has(key)) byCode.set(key, input);
	}
	return [...byCode.values()];
}

function summedStored(outputs: CalculationRow[]): number | null {
	const counts = outputs.map((o) => o.output_reading_count).filter((c): c is number => c != null);
	return counts.length > 0 ? counts.reduce((a, b) => a + b, 0) : null;
}

/**
 * One entry per calculation, ordered by label. A row whose calculation has no `tool_scripts` row
 * still gets an entry, named from the row, so no output is dropped from the list.
 */
export function calculationEntries(
	rows: CalculationRow[],
	scripts: ToolScriptSummary[],
	base: string,
	applied: CalculationSites[] = []
): CalculationEntry[] {
	const sitesOf = new Map(applied.map((a) => [a.calculation, a.sites]));
	const outputsOf = new Map<string, CalculationRow[]>();
	for (const row of rows) {
		outputsOf.set(row.calculation, [...(outputsOf.get(row.calculation) ?? []), row]);
	}
	const entries: CalculationEntry[] = scripts.map((s) => {
		const outputs = outputsOf.get(s.name) ?? [];
		outputsOf.delete(s.name);
		const engine = engineOf(s);
		return {
			calculation: s.name,
			id: s.id,
			label: s.label || s.name,
			engine,
			href: toolboxHref(base, s.id),
			outputs,
			inputs: mergedInputs(outputs),
			fires_on: FIRES_ON[engine],
			stored: summedStored(outputs),
			versionless: engine === 'script' && s.active_version_no == null,
			sites: sitesOf.get(s.name) ?? null,
			decommissioned_at: s.decommissioned_at ?? null,
		};
	});
	for (const [calculation, outputs] of outputsOf) {
		const first = outputs[0];
		entries.push({
			calculation,
			id: null,
			label: calculation,
			engine: first.engine,
			href: first.href,
			outputs,
			inputs: mergedInputs(outputs),
			fires_on: first.fires_on,
			stored: summedStored(outputs),
			versionless: false,
			sites: sitesOf.get(calculation) ?? null,
			decommissioned_at: null,
		});
	}
	return entries.sort((a, b) => a.label.localeCompare(b.label));
}

/** Whether the Toolbox lists a calculation: a decommissioned one only when asked for. */
export function isListed(entry: CalculationEntry, showDecommissioned: boolean): boolean {
	return showDecommissioned || entry.decommissioned_at === null;
}

/** Whether a search matches the calculation's name or label, or the code of an output or input. */
export function matchesSearch(entry: CalculationEntry, query: string): boolean {
	const needle = query.trim().toLowerCase();
	if (!needle) return true;
	return [
		entry.calculation,
		entry.label,
		...entry.outputs.map((o) => o.output_code),
		...entry.inputs.map((i) => i.code),
	].some((text) => text.toLowerCase().includes(needle));
}
