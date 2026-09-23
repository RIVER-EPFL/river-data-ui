import { describe, expect, it } from 'vitest';
import { calculationEntries, isListed, matchesSearch } from './calculations';
import type { CalculationInput, CalculationRow } from '$lib/calculations/rows';
import type { ToolScriptSummary } from '$api/service';

const input = (code: string, unconfigured = false): CalculationInput => ({
	parameter_id: null,
	code,
	unconfigured,
	reading_count: null,
});

const row = (over: Partial<CalculationRow>): CalculationRow => ({
	key: over.output_code ?? 'k',
	engine: 'formula',
	label: 'row',
	calculation: 'pco2',
	output_code: 'out',
	output_parameter_id: null,
	inputs: [],
	fires_on: 'each source reading',
	definition: 'a + b',
	enabled: null,
	href: '/toolbox/sc-pco2',
	output_reading_count: null,
	output_sources: [],
	...over,
});

const scripts = [
	{ id: 'sc-pco2', name: 'pco2', label: 'pCO2', engine: 'formula', enabled: true, active_version_no: null },
	{ id: 'sc-dom', name: 'dom', label: 'DOM Indices', engine: 'script', enabled: false, active_version_no: 3 },
	{ id: 'sc-new', name: 'draft', label: 'Draft', engine: 'script', enabled: true, active_version_no: null },
	{
		id: 'sc-old',
		name: 'pco22',
		label: 'pCO2 (old)',
		engine: 'formula',
		enabled: false,
		active_version_no: null,
		decommissioned_at: '2026-09-23T12:00:00Z',
	},
] as ToolScriptSummary[];

const rows = [
	row({ output_code: 'CH4', inputs: [input('Field_BP'), input('lab_ch4')], output_reading_count: 4 }),
	row({ output_code: 'CO2', inputs: [input('field_bp'), input('lab_co2')], output_reading_count: 6 }),
	row({ output_code: 'N2O', inputs: [input('Field_BP')] }),
	row({
		calculation: 'dom',
		engine: 'script',
		output_code: 'SUVA',
		inputs: [input('DOC', true)],
		enabled: false,
		href: '/toolbox/sc-dom',
		fires_on: 'each write at a visit',
	}),
];

function entries() {
	return calculationEntries(rows, scripts, '');
}

describe('calculationEntries', () => {
	it('gives each calculation one entry, whatever its output count', () => {
		expect(entries().map((e) => e.calculation)).toEqual(['dom', 'draft', 'pco2', 'pco22']);
	});

	it('folds every output of a calculation under its entry', () => {
		const pco2 = entries().find((e) => e.calculation === 'pco2')!;
		expect(pco2.outputs.map((o) => o.output_code)).toEqual(['CH4', 'CO2', 'N2O']);
	});

	it('names each input once, by code, however many outputs read it', () => {
		const pco2 = entries().find((e) => e.calculation === 'pco2')!;
		expect(pco2.inputs.map((i) => i.code)).toEqual(['Field_BP', 'lab_ch4', 'lab_co2']);
	});

	it('sums the stored count over the outputs that have one', () => {
		// 4 + 6, N2O has no coverage
		expect(entries().find((e) => e.calculation === 'pco2')!.stored).toBe(10);
		expect(entries().find((e) => e.calculation === 'dom')!.stored).toBeNull();
	});

	it('lists an R script with no active version, which has no outputs', () => {
		const draft = entries().find((e) => e.calculation === 'draft')!;
		expect(draft.outputs).toEqual([]);
		expect(draft.versionless).toBe(true);
		expect(draft.href).toBe('/toolbox/sc-new');
	});

	it('carries the switch and the id it is saved under, whatever the engine', () => {
		const find = (name: string) => entries().find((e) => e.calculation === name)!;
		expect([find('dom').id, find('dom').enabled]).toEqual(['sc-dom', false]);
		expect([find('pco2').id, find('pco2').enabled]).toEqual(['sc-pco2', true]);
		expect(find('pco2').versionless).toBe(false);
	});

	it('keeps a row whose calculation has no script, under its own name and with no switch', () => {
		const orphan = row({ calculation: 'lost', output_code: 'X' });
		const listed = calculationEntries([orphan], [], '');
		expect(listed.map((e) => [e.calculation, e.outputs.length, e.id])).toEqual([['lost', 1, null]]);
	});

	it('lists nothing with no calculation', () => {
		expect(calculationEntries([], [], '')).toEqual([]);
	});

	it('carries the sites the chain fires each enabled calculation at', () => {
		const fp1 = { id: 'fp1', name: 'FP1' };
		const listed = calculationEntries(rows, scripts, '', [
			{ calculation_id: 'sc-pco2', calculation: 'pco2', sites: [fp1] },
			{ calculation_id: 'sc-new', calculation: 'draft', sites: [] },
		]);
		const sitesOf = (name: string) => listed.find((e) => e.calculation === name)!.sites;
		expect(sitesOf('pco2')).toEqual([fp1]);
		expect(sitesOf('draft')).toEqual([]);
		// Switched off, so the chain fires it nowhere and the list does not name it.
		expect(sitesOf('dom')).toBeNull();
	});
});

describe('isListed', () => {
	const find = (name: string) => entries().find((e) => e.calculation === name)!;

	it('carries when a calculation was decommissioned, and null for a live one', () => {
		expect(find('pco22').decommissioned_at).toBe('2026-09-23T12:00:00Z');
		expect(find('pco2').decommissioned_at).toBeNull();
	});

	it('hides a decommissioned calculation until the filter asks for it', () => {
		expect(isListed(find('pco22'), false)).toBe(false);
		expect(isListed(find('pco22'), true)).toBe(true);
	});

	it('lists a live calculation whether the filter is on or off', () => {
		expect(isListed(find('pco2'), false)).toBe(true);
		expect(isListed(find('pco2'), true)).toBe(true);
	});
});

describe('matchesSearch', () => {
	const pco2 = () => entries().find((e) => e.calculation === 'pco2')!;

	it('matches the label, an output code and an input code, ignoring case', () => {
		expect(matchesSearch(pco2(), 'pco')).toBe(true);
		expect(matchesSearch(pco2(), 'n2o')).toBe(true);
		expect(matchesSearch(pco2(), 'LAB_CH4')).toBe(true);
	});

	it('matches everything on an empty search', () => {
		expect(matchesSearch(pco2(), '  ')).toBe(true);
	});

	it('does not match what the calculation neither names, writes nor reads', () => {
		expect(matchesSearch(pco2(), 'SUVA')).toBe(false);
	});
});
