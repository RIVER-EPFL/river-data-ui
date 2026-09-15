import { describe, expect, it } from 'vitest';

import { lintFormula } from '$lib/formula/lint';

import type { Constant, DerivedParameter, Parameter } from '$api/crud';
import {
	blankFormula,
	editableFormula,
	formulaSetBody,
	curveSlots,
	dependencyOrder,
	draftRunBody,
	formulaVariables,
	inputRows,
	outputRows,
	parseReplicates,
	scalarInputs,
	scalarOverrides,
	type EditableFormula,
} from './editor';

const formula = (over: Partial<EditableFormula>): EditableFormula => ({
	id: null,
	code: '',
	name: '',
	units: '',
	description: '',
	formula: '',
	ordinal: 0,
	curve_slot: '',
	per_replicate: '',
	intermediate: false,
	codeLocked: null,
	...over,
});

const parameter = (code: string, name = code, units = ''): Parameter =>
	({ id: code, code, name, default_units: units, category: 'measurement' }) as Parameter;

const constant = (name: string, value: number, units: string | null = null): Constant =>
	({ id: name, name, value, units }) as Constant;

// pCO2's first stage over two letters, then the mean-reading stage.
const set = [
	formula({ id: 'a', code: 'CO2_HS_Um', formula: 'lab_co2_co2ppm * R * lab_co2_lab_temp', ordinal: 1, per_replicate: 'lab_co2_co2ppm' }),
	formula({ id: 'b', code: 'pCO2_HS_uatm', formula: 'CO2_HS_Um / kh + curve_slope', ordinal: 2, curve_slot: 'co2' }),
	formula({ id: 'c', code: 'bp', formula: 'Field_BP_altitude * 2', ordinal: 3, intermediate: true }),
];

describe('inputs of a formula set', () => {
	it('classifies what the set reads and who reads it', () => {
		const rows = inputRows(
			set,
			[parameter('lab_co2_co2ppm', 'CO2 ppm', 'ppm'), parameter('lab_co2_lab_temp', 'Lab temp', 'degC')],
			[constant('R', 0.082, 'L atm / mol K'), constant('kh', 0.033)],
		);
		const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
		expect(byName['lab_co2_co2ppm']).toMatchObject({ kind: 'replicates', detail: 'CO2 ppm (ppm)', readBy: ['CO2_HS_Um'] });
		expect(byName['lab_co2_lab_temp']?.kind).toBe('parameter');
		expect(byName['R']).toMatchObject({ kind: 'constant', detail: '0.082 L atm / mol K' });
		expect(byName['kh']?.detail).toBe('0.033');
		expect(byName['CO2_HS_Um']).toMatchObject({ kind: 'step', readBy: ['pCO2_HS_uatm'] });
		expect(byName['curve_slope']).toMatchObject({ kind: 'curve', detail: 'slot co2' });
		expect(byName['Field_BP_altitude']?.kind).toBe('other');
		// The language's own names are not inputs.
		expect(byName['sqrt']).toBeUndefined();
	});

	// nutrients: NUT_NO3_avg = NUT_NOx_avg - NUT_NO2_avg, walked at the same letter. NO2 drives
	// nothing, so only the group's declaration says it is a family rather than a mean.
	const nutrients = [
		formula({
			id: 'n',
			code: 'NUT_NO3_avg',
			formula: 'NUT_NOx_avg - NUT_NO2_avg',
			ordinal: 1,
			per_replicate: 'NUT_NOx_avg',
		}),
	];
	const nutrientCatalog = [parameter('NUT_NOx_avg', 'NOx'), parameter('NUT_NO2_avg', 'NO2')];

	it('reads a second family walked at the same letter as the family the group declares', () => {
		const rows = inputRows(nutrients, nutrientCatalog, [], ['NUT_NOx_avg', 'NUT_NO2_avg']);
		const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
		expect(byName['NUT_NOx_avg']?.kind).toBe('replicates');
		expect(byName['NUT_NO2_avg']?.kind).toBe('replicates');
	});

	it('leaves an undeclared source a number, which resolves to the mean', () => {
		const rows = inputRows(nutrients, nutrientCatalog, [], ['NUT_NOx_avg']);
		const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
		expect(byName['NUT_NO2_avg']?.kind).toBe('parameter');
	});

	it('leaves a declared family a scalar formula reads a number', () => {
		const scalar = [formula({ id: 's', code: 'ratio', formula: 'NUT_NO2_avg / 2', ordinal: 1 })];
		const rows = inputRows(scalar, nutrientCatalog, [], ['NUT_NO2_avg']);
		expect(rows.find((r) => r.name === 'NUT_NO2_avg')?.kind).toBe('parameter');
	});

	it('lists the outputs in order without the steps', () => {
		expect(outputRows(set)).toEqual([
			{ code: 'CO2_HS_Um', label: 'CO2_HS_Um', units: '', perReplicate: true },
			{ code: 'pCO2_HS_uatm', label: 'pCO2_HS_uatm', units: '', perReplicate: false },
		]);
	});
});

describe('ordering', () => {
	it('puts a formula after every formula whose code it reads', () => {
		// `pCO2_HS_uatm` reads `CO2_HS_Um`, whatever the ordinals say.
		const shuffled = [
			formula({ id: 'b', code: 'pCO2_HS_uatm', formula: 'CO2_HS_Um / kh', ordinal: 1 }),
			formula({ id: 'a', code: 'CO2_HS_Um', formula: 'lab_co2_co2ppm * R', ordinal: 2 }),
		];
		expect(dependencyOrder(shuffled).map((f) => f.code)).toEqual(['CO2_HS_Um', 'pCO2_HS_uatm']);
	});

	it('keeps ordinal then code between two formulas that read nothing of each other', () => {
		const loose = [
			formula({ id: 'y', code: 'y', formula: 'Depth * 2', ordinal: 2 }),
			formula({ id: 'x', code: 'x', formula: 'Depth * 3', ordinal: 1 }),
			formula({ id: 'w', code: 'a', formula: 'Depth * 4', ordinal: 1 }),
		];
		expect(dependencyOrder(loose).map((f) => f.code)).toEqual(['a', 'x', 'y']);
	});

	it('reads a shared step like any other step of the set, whatever its ordinal', () => {
		// A declared step carries the ordinal it has in the calculation that wrote it, which is
		// no order at all here: what orders it is that `pco2_out` reads it.
		const withShared = [
			formula({ id: 'out', code: 'pco2_out', formula: 'bp * 2', ordinal: 1 }),
			formula({ id: 'step', code: 'bp', formula: 'Field_BP * 1', ordinal: 7, intermediate: true, declarationId: 'd1' }),
		];
		expect(dependencyOrder(withShared).map((f) => f.code)).toEqual(['bp', 'pco2_out']);
	});

	it('still lists every formula when two read each other', () => {
		const cycle = [
			formula({ id: 'p', code: 'p', formula: 'q + 1', ordinal: 1 }),
			formula({ id: 'q', code: 'q', formula: 'p + 1', ordinal: 2 }),
		];
		expect(dependencyOrder(cycle).map((f) => f.code)).toEqual(['p', 'q']);
	});

	it('places a new formula after the last', () => {
		expect(blankFormula(set).ordinal).toBe(4);
		expect(blankFormula([]).ordinal).toBe(1);
	});
});

describe('a run at a visit', () => {
	it('carries the set in order, the visit, and each family as a list with its gaps', () => {
		const body = draftRunBody([set[1]!, set[0]!], { siteId: 's1', collectedAt: '2025-07-02T09:00:00Z' }, {
			lab_co2_co2ppm: '410, , 415',
			unused: '',
		});
		expect(body.formulas.map((f) => f.code)).toEqual(['CO2_HS_Um', 'pCO2_HS_uatm']);
		expect(body.formulas[0]).toMatchObject({ per_replicate: 'lab_co2_co2ppm', intermediate: false });
		expect(body.formulas[0]?.name).toBeUndefined();
		expect(body.inputs).toEqual({
			site_id: 's1',
			collected_at: '2025-07-02T09:00:00Z',
			lab_co2_co2ppm: [410, null, 415],
		});
	});

	it('binds each declared curve slot to the curve chosen for it', () => {
		const corrected = [
			formula({ id: 'c', code: 'corrected', formula: 'raw * curve_slope + curve_intercept', ordinal: 1, curve_slot: 'vaisala' }),
			formula({ id: 'd', code: 'doubled', formula: 'corrected * 2', ordinal: 2 }),
		];
		expect(curveSlots(corrected)).toEqual(['vaisala']);

		const body = draftRunBody(corrected, { siteId: 's1', collectedAt: '2025-07-02T09:00:00Z' }, {}, {
			vaisala: { standard_curve_id: 'curve-1' },
		});
		expect(body.inputs).toMatchObject({ vaisala: { standard_curve_id: 'curve-1' } });
	});

	it('sends nothing for a slot no curve was chosen for', () => {
		const corrected = [
			formula({ id: 'c', code: 'corrected', formula: 'raw * curve_slope', ordinal: 1, curve_slot: 'vaisala' }),
		];
		const body = draftRunBody(corrected, { siteId: 's1', collectedAt: '2025-07-02T09:00:00Z' }, {}, {
			vaisala: null,
		});
		expect(body.inputs).not.toHaveProperty('vaisala');
	});

	it('carries a typed scalar, and a typed constant in place of the catalog', () => {
		const rows = inputRows(
			set,
			[parameter('lab_co2_co2ppm'), parameter('lab_co2_lab_temp')],
			[constant('R', 0.082), constant('kh', 0.033)],
		);
		expect(scalarInputs(rows).map((r) => r.name)).toEqual([
			'R',
			'lab_co2_lab_temp',
			'kh',
			'Field_BP_altitude',
		]);
		const overrides = scalarOverrides(rows, {
			lab_co2_lab_temp: '7.6',
			Field_BP_altitude: '1936',
			R: '0.0821',
			kh: '  ',
			CO2_HS_Um: '99',
		});
		expect(overrides.inputs).toEqual({ lab_co2_lab_temp: 7.6, Field_BP_altitude: 1936 });
		expect(overrides.constants).toEqual({ R: 0.0821 });

		const body = draftRunBody(
			[set[1]!, set[0]!],
			{ siteId: 's1', collectedAt: '2025-07-02T09:00:00Z' },
			{ lab_co2_co2ppm: '410, 415' },
			{},
			overrides,
		);
		expect(body.inputs).toEqual({
			site_id: 's1',
			collected_at: '2025-07-02T09:00:00Z',
			lab_co2_co2ppm: [410, 415],
			lab_co2_lab_temp: 7.6,
			Field_BP_altitude: 1936,
		});
		expect(body.constants).toEqual({ R: 0.0821 });
	});

	it('sends no constants block when every box is blank', () => {
		const body = draftRunBody(set, { siteId: 's1', collectedAt: '2025-07-02T09:00:00Z' }, {});
		expect(body.constants).toBeUndefined();
	});

	it('reads a replicate list with blanks as unmeasured repeats', () => {
		expect(parseReplicates('1 2 3')).toEqual([1, 2, 3]);
		expect(parseReplicates('1,,3')).toEqual([1, null, 3]);
		expect(parseReplicates('1; -; 3')).toEqual([1, null, 3]);
		expect(parseReplicates('')).toEqual([]);
	});
});


describe('what a formula may name', () => {
	/// `Field_BP_altitude`, the first formula of the CNET field_data set, reads the station's
	/// elevation. The server resolves it from the site's own row, so the builder has to offer it
	/// and the lint has to accept it.
	it('offers the columns of a site beside the catalog', () => {
		const vars = formulaVariables([parameter('Dissolved_O2')]);
		expect(vars.map((v) => v.name)).toContain('altitude_m');
		expect(vars.find((v) => v.name === 'altitude_m')?.category).toBe('site property');
		expect(vars.map((v) => v.name)).toContain('Dissolved_O2');
	});

	it('leaves device health out, which is not a formula input', () => {
		const health = { ...parameter('Battery'), category: 'device_health' } as Parameter;
		expect(formulaVariables([health]).map((v) => v.name)).not.toContain('Battery');
	});

	it('lints a formula reading a site property clean', () => {
		const variables = formulaVariables([]).map((v) => v.name);
		expect(lintFormula('altitude_m * 2', { variables })).toEqual([]);
		expect(lintFormula('elevation_m * 2', { variables })[0]?.kind).toBe('unknown_identifier');
	});
});

describe('a formula as the page holds it', () => {
	it('round-trips the description a formula was authored with', () => {
		const stored = {
			id: 'f-1',
			code: 'Field_BP_altitude',
			name: 'Field barometric pressure',
			units: 'hPa',
			formula: 'pressure0 * exp(-g * elev / (Rd * (Tair + Kelvin)))',
			description: 'calcAlt2BP: bigleaf 0.8.2 pressure.from.elevation(elev, Tair)',
			ordinal: 1,
			curve_slot: null,
			per_replicate: null,
			intermediate: false,
		} as unknown as DerivedParameter;
		const held = editableFormula(stored);
		expect(held.description).toBe('calcAlt2BP: bigleaf 0.8.2 pressure.from.elevation(elev, Tair)');
		expect(formulaSetBody([held], false).formulas[0].description).toBe(
			'calcAlt2BP: bigleaf 0.8.2 pressure.from.elevation(elev, Tair)'
		);
	});

	it('sends no description for a formula that carries none', () => {
		expect(
			formulaSetBody([formula({ code: 'X', formula: '1' })], false).formulas[0].description,
		).toBeNull();
	});

	it('carries the reason the code is no longer free, so the field can say it', () => {
		const stored = {
			id: 'f-2',
			code: 'SUVA',
			name: 'SUVA',
			units: 'L/mg/m',
			formula: 'a254 * 1000 / DOC_avg_ppb',
			ordinal: 1,
			code_locked: '412 readings are stored under it'
		} as unknown as DerivedParameter;
		expect(editableFormula(stored).codeLocked).toBe('412 readings are stored under it');
	});

	it('leaves an unpublished code free', () => {
		const stored = {
			id: 'f-3',
			code: 'SUVA',
			formula: '1',
			ordinal: 1
		} as unknown as DerivedParameter;
		expect(editableFormula(stored).codeLocked).toBeNull();
	});
});

describe('the set a save posts', () => {
	// Scenario: an author edits one formula, adds another and drops a third, then saves once.
	// Expected behaviour: one body carrying the whole set, the arm the author chose, and nothing
	// of the steps this calculation only reads.
	const edited = [
		formula({ id: 'a', code: ' CO2_HS_Um ', formula: 'x * 2', ordinal: 1, per_replicate: ' lab_co2_co2ppm ' }),
		formula({ code: 'pCO2_HS_uatm', name: '', units: ' uatm ', formula: 'CO2_HS_Um / kh', ordinal: 2, curve_slot: ' co2 ' }),
	];

	it('carries every own formula, trimmed, with its id', () => {
		const body = formulaSetBody(edited, false);
		expect(body.formulas).toEqual([
			{
				id: 'a',
				code: 'CO2_HS_Um',
				name: 'CO2_HS_Um',
				units: '',
				description: null,
				formula: 'x * 2',
				ordinal: 1,
				per_replicate: 'lab_co2_co2ppm',
				curve_slot: null,
				intermediate: false,
			},
			{
				id: null,
				code: 'pCO2_HS_uatm',
				name: 'pCO2_HS_uatm',
				units: 'uatm',
				description: null,
				formula: 'CO2_HS_Um / kh',
				ordinal: 2,
				per_replicate: null,
				curve_slot: 'co2',
				intermediate: false,
			},
		]);
	});

	it('leaves out a step read through a declaration', () => {
		const shared = formula({ id: 'z', code: 'bp', formula: '1', ordinal: 3, declarationId: 'd-1' });
		expect(formulaSetBody([...edited, shared], false).formulas.map((f) => f.code)).toEqual([
			'CO2_HS_Um',
			'pCO2_HS_uatm',
		]);
	});

	it('carries the arm the author chose', () => {
		expect(formulaSetBody(edited, false).migrate_stored).toBe(false);
		expect(formulaSetBody(edited, true).migrate_stored).toBe(true);
	});

	it('drops a formula the author removed, by leaving it out of the set', () => {
		const removed = edited.filter((f) => f.id !== 'a');
		expect(formulaSetBody(removed, false).formulas.map((f) => f.id)).toEqual([null]);
	});
});
