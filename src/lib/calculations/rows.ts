// One list of every calculation that computes a parameter, whichever engine does it.
//
// A formula and an R script are two engines of one concept, and an admin asking "what computes DOM
// at Saxon, and is it current" reads one list for both. Each row links to the page its calculation
// is authored on. A formula owned by no calculation is a shared step (Q156), which computes
// nothing of its own and is read inside every calculation that declares it, so it is not a row
// here (Q238).

import type { DerivedParameter, Parameter } from '$api/crud';
import type {
	CalculationHealth,
	SlotCoverage,
	ToolDescriptor,
	ToolScriptSummary,
} from '$api/service';
import { toolboxHref } from '$lib/toolbox/route';

export type CalculationEngine = 'formula' | 'script';

export interface CalculationInput {
	parameter_id: string | null;
	code: string;
	/** No site has a `site_parameters` row for it, so the calculation can never fire on real data. */
	unconfigured: boolean;
	/** Readings stored under it, from the coverage. Null when the coverage was not asked for. */
	reading_count: number | null;
}

export interface CalculationRow {
	key: string;
	engine: CalculationEngine;
	label: string;
	/** The calculation's name, as a finding and a scoped recompute name it. */
	calculation: string;
	/** The parameter this calculation writes, by code. */
	output_code: string;
	output_parameter_id: string | null;
	inputs: CalculationInput[];
	/** When it runs: a formula recomputes per source reading, a script per write at a visit. */
	fires_on: string;
	/** The formula text, or the script's active version. */
	definition: string;
	/** Scripts can be switched out of the calculation set; a formula has no such switch. */
	enabled: boolean | null;
	/** Where the authoring for this row lives. */
	href: string;
	/** Readings already stored under the output, from the coverage. */
	output_reading_count: number | null;
	/** Where those stored values came from, which is what says whether any run produced them. */
	output_sources: string[];
}

function coverageOf(
	coverage: SlotCoverage[],
	match: (c: SlotCoverage) => boolean
): SlotCoverage | undefined {
	return coverage.find(match);
}

function inputFrom(
	code: string,
	parameterId: string | null,
	coverage: SlotCoverage[]
): CalculationInput {
	const cover = coverageOf(
		coverage,
		(c) =>
			(parameterId != null && c.parameter_id === parameterId) ||
			c.parameter_code.toLowerCase() === code.toLowerCase()
	);
	return {
		parameter_id: parameterId ?? cover?.parameter_id ?? null,
		code,
		unconfigured: cover != null && cover.sites_configured === 0,
		reading_count: cover?.reading_count ?? null,
	};
}

/**
 * The rows for both engines, ordered by output code so the two kinds interleave by what they
 * produce rather than sitting in separate blocks.
 */
export function calculationRows(args: {
	derived: DerivedParameter[];
	tools: ToolDescriptor[];
	scripts: ToolScriptSummary[];
	parameters: Parameter[];
	coverage: SlotCoverage[];
	base: string;
}): CalculationRow[] {
	const { derived, tools, scripts, parameters, coverage, base } = args;
	const codeOf = new Map(parameters.map((p) => [p.id, p.code]));
	const nameOf = new Map(scripts.map((s) => [s.id, s.name]));
	const rows: CalculationRow[] = [];

	for (const d of derived) {
		if (!d.tool_script_id) continue;
		rows.push({
			key: `formula:${d.id}`,
			engine: 'formula',
			calculation: nameOf.get(d.tool_script_id) ?? d.tool_script_id,
			label: d.name || d.code,
			output_code: d.output_parameter_id ? (codeOf.get(d.output_parameter_id) ?? d.code) : d.code,
			output_parameter_id: d.output_parameter_id,
			inputs: (d.sources ?? []).map((s) =>
				inputFrom(codeOf.get(s.parameter_id) ?? s.variable_name, s.parameter_id, coverage)
			),
			fires_on: 'each source reading',
			definition: d.formula,
			enabled: null,
			href: toolboxHref(base, d.tool_script_id),
			output_reading_count: null,
			output_sources: [],
		});
	}

	const scriptByName = new Map(scripts.map((s) => [s.name, s]));
	for (const t of tools) {
		const script = scriptByName.get(t.name);
		// A formula calculation is served as a tool too; its formulas are already rows above.
		if (script?.engine === 'formula') continue;
		for (const output of t.outputs) {
			const code = output.suggested_parameter_code ?? output.label ?? output.key;
			const cover = coverageOf(coverage, (c) => c.parameter_code.toLowerCase() === code.toLowerCase());
			rows.push({
				key: `script:${t.name}:${output.key}`,
				engine: 'script',
				calculation: t.name,
				label: t.outputs.length > 1 ? `${t.label} (${output.label})` : t.label,
				output_code: code,
				output_parameter_id: cover?.parameter_id ?? null,
				inputs: (t.event_inputs ?? []).map((e) =>
					inputFrom(e.parameter_code, null, coverage)
				),
				fires_on: 'each write at a visit',
				definition: `${t.name} v${t.version_no}`,
				enabled: script?.enabled ?? true,
				href: toolboxHref(base, script?.id ?? t.name),
				output_reading_count: cover?.reading_count ?? null,
				output_sources: cover?.source_systems ?? [],
			});
		}
	}

	rows.sort((a, b) => a.output_code.localeCompare(b.output_code) || a.label.localeCompare(b.label));
	return rows;
}

/** Inputs no site configures, across every row: what an admin has to fix before anything fires. */
export function unconfiguredInputs(rows: CalculationRow[]): string[] {
	const codes = new Set<string>();
	for (const row of rows) {
		for (const input of row.inputs) {
			if (input.unconfigured) codes.add(input.code);
		}
	}
	return [...codes].sort();
}

/**
 * The health a calculation's row shows: its open findings, or a recompute still running or failed.
 * A failed run is shown whatever the findings say, since a run that failed after clearing them
 * leaves none. Undefined when there is nothing to show.
 */
export function standingHealth(h: CalculationHealth | undefined): CalculationHealth | undefined {
	return h && (h.stale_visits > 0 || h.repair || h.janitor_fills.length > 0) ? h : undefined;
}

/**
 * What the janitor had to fill for a calculation, in a line: each value is a write that missed its
 * recompute (Q260). Null when it filled nothing. A site the page cannot name is counted, not named.
 */
export function janitorFillLine(h: CalculationHealth, siteNames: Map<string, string>): string | null {
	const values = h.janitor_fills.reduce((sum, f) => sum + f.values, 0);
	if (values === 0) return null;
	const named = h.janitor_fills.map((f) => siteNames.get(f.site_id)).filter((n): n is string => !!n);
	const others = h.janitor_fills.length - named.length;
	const where = [
		...named,
		...(others > 0 ? [`${others} ${named.length > 0 ? 'other ' : ''}site${others === 1 ? '' : 's'}`] : []),
	];
	const sites = where.length > 1 ? `${where.slice(0, -1).join(', ')} and ${where.at(-1)}` : where[0];
	const was = values === 1 ? 'value was' : 'values were';
	return `${values} ${was} missing and filled automatically at ${sites}, last 24 h`;
}
