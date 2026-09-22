import { describe, expect, it } from 'vitest';
import { calculationRows, unconfiguredInputs } from './rows';
import type { DerivedParameter, Parameter } from '$api/crud';
import type { SlotCoverage, ToolDescriptor, ToolScriptSummary } from '$api/service';

const parameters = [
	{ id: 'p-doc', code: 'DOC' },
	{ id: 'p-suva', code: 'SUVA' },
	{ id: 'p-do', code: 'DO' },
	{ id: 'p-temp', code: 'Temp' },
] as Parameter[];

const coverage: SlotCoverage[] = [
	{
		parameter_id: 'p-doc',
		parameter_code: 'DOC',
		sites_configured: 4,
		reading_count: 120,
		source_systems: ['cnet'],
		run_sources: [],
	},
	{
		parameter_id: 'p-suva',
		parameter_code: 'SUVA',
		sites_configured: 0,
		reading_count: 0,
		source_systems: [],
		run_sources: [],
	},
];

const derived = [
	{
		id: 'd1',
		code: 'DOsat',
		name: 'DO saturation',
		formula: 'do / cap',
		output_parameter_id: 'p-do',
		tool_script_id: 'sc-pco2',
		sources: [
			{ id: 's1', derived_definition_id: 'd1', parameter_id: 'p-temp', variable_name: 'temp' },
		],
	},
] as DerivedParameter[];

const tools = [
	{
		name: 'dom',
		label: 'DOM Indices',
		outputs: [{ key: 'suva', label: 'SUVA', suggested_parameter_code: 'SUVA' }],
		event_inputs: [{ param: 'doc', parameter_code: 'DOC' }],
		version_no: 3,
	},
] as unknown as ToolDescriptor[];

const scripts = [
	{ id: 'sc-dom', name: 'dom', enabled: false, engine: 'script' },
	{ id: 'sc-pco2', name: 'pco2', engine: 'formula' },
] as ToolScriptSummary[];

function rows() {
	return calculationRows({ derived, tools, scripts, parameters, coverage, base: '' });
}

describe('calculationRows', () => {
	it('lists both engines in one order, by what each produces', () => {
		expect(rows().map((r) => r.output_code)).toEqual(['DO', 'SUVA']);
	});

	it('says when each engine fires, which is the difference that matters', () => {
		const [formula, script] = rows();
		expect(formula.engine).toBe('formula');
		expect(formula.fires_on).toBe('each source reading');
		expect(script.engine).toBe('script');
		expect(script.fires_on).toBe('each write at a visit');
	});

	it("carries a script's active version and its enabled switch, a formula neither", () => {
		const [formula, script] = rows();
		expect(script.definition).toBe('dom v3');
		expect(script.enabled).toBe(false);
		expect(formula.definition).toBe('do / cap');
		expect(formula.enabled).toBeNull();
	});

	it('resolves an input to its catalog code and its coverage', () => {
		const script = rows()[1];
		expect(script.inputs[0].code).toBe('DOC');
		expect(script.inputs[0].reading_count).toBe(120);
		expect(script.inputs[0].unconfigured).toBe(false);
	});

	it('leaves an input with no coverage row unmarked rather than calling it unconfigured', () => {
		const formula = rows()[0];
		expect(formula.inputs[0].code).toBe('Temp');
		expect(formula.inputs[0].unconfigured).toBe(false);
		expect(formula.inputs[0].reading_count).toBeNull();
	});
});

describe('unconfiguredInputs', () => {
	it('names an input no site configures, which is what stops a calculation firing', () => {
		const withSuvaInput = calculationRows({
			derived: [],
			tools: [
				{
					name: 'x',
					label: 'X',
					outputs: [{ key: 'o', label: 'O', suggested_parameter_code: 'O' }],
					event_inputs: [{ param: 's', parameter_code: 'SUVA' }],
					version_no: 1,
				},
			] as unknown as ToolDescriptor[],
			scripts: [],
			parameters,
			coverage,
			base: '',
		});
		expect(unconfiguredInputs(withSuvaInput)).toEqual(['SUVA']);
	});

	it('names nothing when every input is configured', () => {
		expect(unconfiguredInputs(rows())).toEqual([]);
	});
});

describe('the calculation a row belongs to', () => {
	it('is the script name for a script row', () => {
		expect(rows().find((r) => r.engine === 'script')?.calculation).toBe('dom');
	});

	it('is the owning calculation for a formula', () => {
		expect(rows().find((r) => r.engine === 'formula')?.calculation).toBe('pco2');
	});

	it('leaves a shared step out of the list, which computes nothing of its own', () => {
		const step = { ...derived[0], id: 'd2', code: 'water_k', tool_script_id: null };
		const listed = calculationRows({
			derived: [...derived, step] as DerivedParameter[],
			tools: [],
			scripts,
			parameters,
			coverage,
			base: '',
		});
		expect(listed.map((r) => r.label)).toEqual(['DO saturation']);
	});

	it("links each row to the page its calculation is authored on", () => {
		const [formula, script] = rows();
		expect(formula.href).toBe('/toolbox/sc-pco2');
		expect(script.href).toBe('/toolbox/sc-dom');
	});

	it('lists a formula calculation once, by its formulas, not again as a script', () => {
		const pco2 = { ...tools[0], name: 'pco2_demo', label: 'pCO2' } as ToolDescriptor;
		const listed = calculationRows({
			derived,
			tools: [pco2],
			scripts: [{ id: 'sc-pco2', name: 'pco2_demo', engine: 'formula' }] as ToolScriptSummary[],
			parameters,
			coverage,
			base: '',
		});
		expect(listed.map((r) => r.engine)).toEqual(['formula']);
	});
});
