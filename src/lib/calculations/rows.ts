// One list of everything that computes a parameter, whichever engine does it.
//
// A formula on `/derived` and an R script under Manage Tools are two definitions of one concept,
// and an admin asked "what computes DOM at Saxon, and is it current" was reading two pages, neither
// of which answered the second half. This folds both into rows with the same columns, so the
// question is asked once. Authoring stays where it is; this is the listing.

import type { DerivedParameter, Parameter } from '$api/crud';
import type { SlotCoverage, ToolDescriptor, ToolScriptSummary } from '$api/service';

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
	/** The calculation's name, as a finding and a scoped recompute name it. Null for a standalone
	 *  continuous definition, which belongs to no calculation and raises none. */
	calculation: string | null;
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
		rows.push({
			key: `formula:${d.id}`,
			engine: 'formula',
			calculation: d.tool_script_id ? (nameOf.get(d.tool_script_id) ?? null) : null,
			label: d.name || d.code,
			output_code: d.output_parameter_id ? (codeOf.get(d.output_parameter_id) ?? d.code) : d.code,
			output_parameter_id: d.output_parameter_id,
			inputs: (d.sources ?? []).map((s) =>
				inputFrom(codeOf.get(s.parameter_id) ?? s.variable_name, s.parameter_id, coverage)
			),
			fires_on: 'each source reading',
			definition: d.formula,
			enabled: null,
			href: `${base}/derived/${d.id}`,
			output_reading_count: null,
			output_sources: [],
		});
	}

	const scriptByName = new Map(scripts.map((s) => [s.name, s]));
	for (const t of tools) {
		const script = scriptByName.get(t.name);
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
				href: `${base}/tools/manage`,
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
