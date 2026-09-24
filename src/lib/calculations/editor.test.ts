import { describe, expect, it } from 'vitest';

import { lintFormula } from '$lib/formula/lint';

import type { Constant, DerivedParameter, Parameter } from '$api/crud';
import {
	blankFormula,
	cellFields,
	editableFormula,
	blankThresholds,
	carryRename,
	formulaSetBody,
	isSharedStep,
	seriesBlocker,
	thresholdWrites,
	sharedStepWrites,
	curveSlots,
	dependencyOrder,
	draftRunBody,
	formulaVariables,
	inputRows,
	receivedSteps,
	stepOffers,
	untilLeft,
	readOnlyThroughGuards,
	outputRows,
	parseReplicates,
	drawable,
	previewable,
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
	shared: false,
	thresholds: blankThresholds(),
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
	// pco2real reads the lab's temperature and pressure only through coalesce, falling back to the
	// lab averages, so a visit without them still computes.
	const pco2 = [
		formula({
			id: 'p',
			code: 'pCO2_real',
			formula:
				'lab_co2_co2ppm * coalesce(lab_co2_lab_press / 1013.25, lab_press_avg_atm) / (coalesce(lab_co2_lab_temp, lab_temp_avg_degC) + WTW_Temp_degC_1)',
			ordinal: 1,
		}),
	];
	const pco2Catalog = [
		parameter('lab_co2_co2ppm', 'CO2 ppm'),
		parameter('lab_co2_lab_press', 'Lab pressure'),
		parameter('lab_co2_lab_temp', 'Lab temperature'),
		parameter('WTW_Temp_degC_1', 'Water temperature'),
	];

	it('marks an input read only through coalesce optional and the rest required', () => {
		const rows = inputRows(pco2, pco2Catalog, [constant('lab_press_avg_atm', 0.94), constant('lab_temp_avg_degC', 21)]);
		const optional = Object.fromEntries(rows.map((r) => [r.name, r.optional]));
		expect(optional).toMatchObject({
			lab_co2_co2ppm: false,
			WTW_Temp_degC_1: false,
			lab_co2_lab_press: true,
			lab_co2_lab_temp: true,
		});
	});

	it('requires an input a second formula reads outside a guard', () => {
		const rows = inputRows(
			[...pco2, formula({ id: 'q', code: 'press_atm', formula: 'lab_co2_lab_press / 1013.25', ordinal: 2 })],
			pco2Catalog,
			[],
		);
		expect(rows.find((r) => r.name === 'lab_co2_lab_press')?.optional).toBe(false);
		expect(rows.find((r) => r.name === 'lab_co2_lab_temp')?.optional).toBe(true);
	});

	it('reads a guard the way the server does', () => {
		expect(readOnlyThroughGuards('coalesce(x, 1)', 'x')).toBe(true);
		expect(readOnlyThroughGuards('if(is_missing(x), 0, x * 2)', 'x')).toBe(true);
		expect(readOnlyThroughGuards('coalesce(x, 1) + x', 'x')).toBe(false);
		expect(readOnlyThroughGuards('sqrt(x)', 'x')).toBe(false);
		expect(readOnlyThroughGuards('x', 'x')).toBe(false);
		// Not read at all is not a guarded read.
		expect(readOnlyThroughGuards('coalesce(y, 1)', 'x')).toBe(false);
	});

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

	it('keeps a half-typed name out of the inputs until the field is left', () => {
		const typed = formula({ id: 'o', code: 'CO2_HS_Um2', formula: 'l', ordinal: 2 });
		const formulas = [...pco2, typed];
		const names = (f: EditableFormula[]) => inputRows(f, pco2Catalog, []).map((r) => r.name);
		// Focused on an empty formula, nothing it types reaches the table.
		expect(names(untilLeft(formulas, { formula: typed, text: '' }))).not.toContain('l');
		expect(names(untilLeft(formulas, { formula: typed, text: '' }))).toEqual(names(pco2));
		// A name it read at focus stays while it is edited away.
		expect(names(untilLeft(formulas, { formula: typed, text: 'vol_sa' }))).toContain('vol_sa');
		// Left, the typed text goes through.
		expect(names(untilLeft(formulas, null))).toContain('l');
		// A name another formula reads is still there.
		const other = formula({ id: 'q', code: 'q', formula: 'l * 2', ordinal: 3 });
		expect(names(untilLeft([...formulas, other], { formula: typed, text: '' }))).toContain('l');
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

	it('leaves a row with no code or no expression out of what can be previewed', () => {
		const rows = [
			formula({ code: 'out', formula: 'a + 1', ordinal: 1 }),
			formula({ code: '   ', formula: 'a + 2', ordinal: 2 }),
			formula({ code: 'half', formula: '  ', ordinal: 3 }),
		];
		expect(previewable(rows).map((f) => f.code)).toEqual(['out']);
		expect(previewable([blankFormula([])])).toEqual([]);
	});
});

describe('what the chart draws, being a guide', () => {
	const site = { measured: ['a', 'b'], constants: ['k'] };

	it('leaves out a formula the parser does not reach the end of', () => {
		const rows = [
			formula({ code: 'good', formula: 'a + b', ordinal: 1 }),
			formula({ code: 'typing', formula: 'a a', ordinal: 2 }),
			formula({ code: 'operand', formula: 'a +', ordinal: 3 }),
		];
		const { draw, skipped } = drawable(rows, site);
		expect(draw.map((f) => f.code)).toEqual(['good']);
		expect(skipped).toEqual([
			{ code: 'typing', reason: 'still being written' },
			{ code: 'operand', reason: 'still being written' },
		]);
	});

	it('leaves out a formula reading what the site does not measure, and names it', () => {
		const rows = [formula({ code: 'out', formula: 'a * turbidity', ordinal: 1 })];
		const { draw, skipped } = drawable(rows, site);
		expect(draw).toEqual([]);
		expect(skipped).toEqual([{ code: 'out', reason: 'the site does not measure turbidity' }]);
	});

	it('draws a formula over a constant, a step and the language, none of which the site measures', () => {
		const rows = [
			formula({ code: 'step', formula: 'a * k', intermediate: true, ordinal: 1 }),
			formula({ code: 'out', formula: 'exp(step) * pi + latitude', ordinal: 2 }),
		];
		const { draw, skipped } = drawable(rows, site);
		expect(draw.map((f) => f.code)).toEqual(['step', 'out']);
		expect(skipped).toEqual([]);
	});

	it('asks nothing of a site it has none for, so a set draws before a site is chosen', () => {
		const rows = [formula({ code: 'out', formula: 'a * turbidity', ordinal: 1 })];
		expect(drawable(rows, null).draw.map((f) => f.code)).toEqual(['out']);
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

	it('leaves out a row whose code or formula is still being typed', () => {
		const rows = [
			...set,
			formula({ id: null, code: 'lab_e', formula: '', ordinal: 3 }),
			formula({ id: null, code: '', formula: 'a + 1', ordinal: 4 }),
		];
		const visit = { siteId: 's1', collectedAt: '2025-07-02T09:00:00Z' };
		expect(draftRunBody(rows, visit, {}).formulas).toEqual(draftRunBody(set, visit, {}).formulas);
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

	it('offers the numeric site columns only, which are the ones the server can serve', () => {
		const properties = formulaVariables([])
			.filter((v) => v.category === 'site property')
			.map((v) => v.name);
		expect(properties).toEqual(['latitude', 'longitude', 'altitude_m']);
	});

	it('marks a parameter entered per replicate, and no other', () => {
		const vars = formulaVariables(
			[parameter('lab_co2_co2ppm'), parameter('Field_BP')],
			['lab_co2_co2ppm'],
		);
		expect(vars.find((v) => v.name === 'lab_co2_co2ppm')?.replicated).toBe(true);
		expect(vars.find((v) => v.name === 'Field_BP')?.replicated).toBe(false);
		expect(vars.find((v) => v.name === 'altitude_m')?.replicated).toBe(false);
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
		expect(formulaSetBody([held]).formulas[0].description).toBe(
			'calcAlt2BP: bigleaf 0.8.2 pressure.from.elevation(elev, Tair)'
		);
	});

	it('sends no description for a formula that carries none', () => {
		expect(
			formulaSetBody([formula({ code: 'X', formula: '1' })]).formulas[0].description,
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
		const body = formulaSetBody(edited);
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
		const shared = formula({ id: 'z', code: 'bp', formula: '1', ordinal: 3, intermediate: true, shared: true, declarationId: 'd-1' });
		expect(formulaSetBody([...edited, shared]).formulas.map((f) => f.code)).toEqual([
			'CO2_HS_Um',
			'pCO2_HS_uatm',
		]);
	});

	it('drops a formula the author removed, by leaving it out of the set', () => {
		const removed = edited.filter((f) => f.id !== 'a');
		expect(formulaSetBody(removed).formulas.map((f) => f.id)).toEqual([null]);
	});
});

describe('a run with no visit', () => {
	it('carries the typed numbers and names no visit, so nothing is read from storage', () => {
		const body = draftRunBody(set, null, { lab_co2: '410, 430' }, {}, {
			inputs: { lab_temp: 21 },
			constants: {},
		});
		expect(body.inputs?.site_id).toBeUndefined();
		expect(body.inputs?.collected_at).toBeUndefined();
		expect(body.inputs?.lab_co2).toEqual([410, 430]);
		expect(body.inputs?.lab_temp).toBe(21);
	});
});

describe('a step any calculation may read', () => {
	const step = (over: Partial<EditableFormula> = {}) =>
		formula({ code: 'water_k', formula: 'WTW_Temp_degC_1 + 273.15', intermediate: true, ...over });

	it('belongs to the calculation until the author says otherwise', () => {
		expect(isSharedStep(step())).toBe(false);
		expect(formulaSetBody([step()]).formulas.map((f) => f.code)).toEqual(['water_k']);
		expect(sharedStepWrites([step()])).toEqual([]);
	});

	it('leaves the set body once it is shared, so the save neither rewrites nor deletes it', () => {
		const shared = step({ shared: true });
		expect(isSharedStep(shared)).toBe(true);
		expect(formulaSetBody([shared, formula({ code: 'SUVA', formula: 'water_k * 2' })])
			.formulas.map((f) => f.code)).toEqual(['SUVA']);
	});

	it('is written on its own when nothing declares it here yet', () => {
		expect(sharedStepWrites([step({ shared: true })]).map((f) => f.code)).toEqual(['water_k']);
	});

	it('is written once: a step already declared here is left alone', () => {
		const declared = step({ id: 'f-1', shared: true, declarationId: 'd-1' });
		expect(sharedStepWrites([declared], [declared])).toEqual([]);
		expect(formulaSetBody([declared]).formulas).toEqual([]);
	});

	it('is written again when the author corrects it where it is declared', () => {
		const declared = step({ id: 'f-1', shared: true, declarationId: 'd-1' });
		const corrected = { ...declared, formula: 'WTW_Temp_degC_1 + 273.16', units: 'K' };
		expect(sharedStepWrites([corrected], [declared]).map((f) => f.formula)).toEqual([
			'WTW_Temp_degC_1 + 273.16',
		]);
		expect(formulaSetBody([corrected]).formulas).toEqual([]);
	});

	it('travels in the set save, so the correction and the version are one act', () => {
		const declared = step({ id: 'f-1', shared: true, declarationId: 'd-1' });
		const corrected = { ...declared, formula: 'WTW_Temp_degC_1 + 273.16', units: ' K ' };
		expect(formulaSetBody([corrected], [declared]).shared_steps).toEqual([
			{
				id: 'f-1',
				code: 'water_k',
				name: 'water_k',
				units: 'K',
				description: null,
				formula: 'WTW_Temp_degC_1 + 273.16',
				per_replicate: null,
				curve_slot: null,
			},
		]);
		expect(formulaSetBody([declared], [declared]).shared_steps).toEqual([]);
		expect(formulaSetBody([step({ shared: true })]).shared_steps.map((s) => s.id)).toEqual([null]);
	});

	it('returns to the set, under its id, when the author stops sharing a declared step', () => {
		const declared = step({ id: 'f-1', shared: true, declarationId: 'd-1' });
		const unshared = { ...declared, shared: false };
		expect(isSharedStep(unshared)).toBe(false);
		expect(sharedStepWrites([unshared], [declared])).toEqual([]);
		expect(formulaSetBody([unshared]).formulas.map((f) => f.id)).toEqual(['f-1']);
	});

	it('keeps its identity when a stored step of this calculation is shared', () => {
		const moved = step({ id: 'f-2', shared: true });
		expect(sharedStepWrites([moved]).map((f) => f.id)).toEqual(['f-2']);
	});

	it('cannot be shared without being a step: an output publishes under its own parameter', () => {
		const output = formula({ code: 'SUVA', formula: 'a254', shared: true });
		expect(isSharedStep(output)).toBe(false);
		expect(sharedStepWrites([output])).toEqual([]);
		expect(formulaSetBody([output]).formulas.map((f) => f.code)).toEqual(['SUVA']);
	});
});

describe('a step received through a declared one', () => {
	const stored = (id: string, code: string, text: string, owner: string | null = null) =>
		({
			id,
			code,
			name: code,
			units: '',
			formula: text,
			ordinal: 0,
			tool_script_id: owner,
			intermediate: true,
		}) as unknown as DerivedParameter;
	const steps = [
		stored('f-1', 'water_k', 'WTW_Temp_degC_1 + 273.15'),
		stored('f-2', 'kh', '0.034 * exp(c_const * (1 / water_k - 1 / 298.15))'),
		stored('f-3', 'apart', 'Dissolved_O2'),
		stored('f-4', 'owned', 'Dissolved_O2', 'calc-1'),
	];
	const declared = { ...editableFormula(steps[1]), declarationId: 'd-1', shared: true };

	it('is listed with the step it comes through', () => {
		const received = receivedSteps([declared], steps);
		expect(received.map((f) => [f.code, f.receivedThrough, f.shared])).toEqual([
			['water_k', 'kh', true],
		]);
	});

	it('walks every shared step a received one reads, each once', () => {
		const chain = [
			stored('f-1', 'a', 'Dissolved_O2'),
			stored('f-2', 'b', 'a + 1'),
			stored('f-3', 'c', 'a + b'),
		];
		const top = { ...editableFormula(chain[2]), declarationId: 'd-1', shared: true };
		expect(receivedSteps([top], chain).map((f) => f.code).sort()).toEqual(['a', 'b']);
	});

	it('is never written by the save, which would declare it', () => {
		const [received] = receivedSteps([declared], steps);
		expect(sharedStepWrites([declared, received], [declared, received])).toEqual([]);
		expect(sharedStepWrites([received])).toEqual([]);
		expect(formulaSetBody([declared, received]).formulas).toEqual([]);
	});
});

describe("an output's own bounds", () => {
	const suva = (over: Partial<EditableFormula> = {}) =>
		formula({ id: 'f-1', code: 'SUVA', formula: 'a254 / DOC', ...over });
	const saved = [{ code: 'SUVA', output_parameter_id: 'p-1' }];
	const bounds = (over: Partial<EditableFormula['thresholds']>) => ({ ...blankThresholds(), ...over });

	it('writes nothing while the four fields read as they were stored', () => {
		const stored = suva({ thresholds: bounds({ warningMin: 2 }) });
		const edited = suva({ thresholds: bounds({ warningMin: '2' }) });
		expect(thresholdWrites([edited], [stored], saved)).toEqual([]);
	});

	it('writes the bounds the author typed onto the parameter the save minted', () => {
		const edited = suva({ id: null, thresholds: bounds({ warningMin: '2', alarmMax: '9' }) });
		expect(thresholdWrites([edited], [], saved)).toEqual([
			{ parameterId: 'p-1', patch: { warning_min: 2, warning_max: null, alarm_min: null, alarm_max: 9 } },
		]);
	});

	it('clears a bound the author emptied, rather than leaving the old one standing', () => {
		const stored = suva({ thresholds: bounds({ warningMin: 2, alarmMax: 9 }) });
		const edited = suva({ thresholds: bounds({ alarmMax: 9 }) });
		expect(thresholdWrites([edited], [stored], saved)[0].patch.warning_min).toBeNull();
	});

	it('leaves a step alone: it publishes under no parameter', () => {
		const step = suva({ intermediate: true, thresholds: bounds({ warningMin: '2' }) });
		expect(thresholdWrites([step], [], saved)).toEqual([]);
	});

	it('leaves an output the save minted no parameter for alone', () => {
		const edited = suva({ thresholds: bounds({ warningMin: '2' }) });
		expect(thresholdWrites([edited], [], [{ code: 'SUVA', output_parameter_id: null }])).toEqual([]);
	});
});

describe('the fields a cell panel shows', () => {
	it('gives an output its name and bounds', () => {
		expect(cellFields(formula({ code: 'SUVA', formula: 'a254 / DOC' }))).toEqual({ name: true, bounds: true, curveSlot: false });
	});

	it('gives a step neither: it publishes under no parameter', () => {
		const step = formula({ code: 'bp', formula: 'Field_BP * 2', intermediate: true });
		expect(cellFields(step)).toEqual({ name: false, bounds: false, curveSlot: false });
	});

	it('gives a shared step neither', () => {
		const step = formula({ code: 'bp', formula: 'Field_BP * 2', intermediate: true, shared: true });
		expect(cellFields(step)).toEqual({ name: false, bounds: false, curveSlot: false });
	});

	it('gives an output its name back once the step switch is off, whatever it was shared as', () => {
		expect(cellFields(formula({ code: 'SUVA', formula: 'a254 / DOC', shared: true })).name).toBe(true);
	});

	it('shows the curve slot once the formula names a coefficient', () => {
		expect(cellFields(formula({ formula: 'lab_doc * curve_slope' })).curveSlot).toBe(true);
		expect(cellFields(formula({ formula: 'lab_doc + curve_intercept', intermediate: true })).curveSlot).toBe(true);
	});

	it('keeps a slot already set in view, so it can be cleared', () => {
		expect(cellFields(formula({ formula: 'lab_doc * 2', curve_slot: 'doc' })).curveSlot).toBe(true);
	});
});

describe('whether a set can be read as a series', () => {
	const blockerOf = (fs: EditableFormula[]) => seriesBlocker(fs);

	it('can, when every input is a parameter the site streams', () => {
		expect(blockerOf([formula({ code: 'SUVA', formula: 'a254 / DOC' })])).toBeNull();
	});

	it('cannot, when a formula corrects with a curve chosen per sample', () => {
		expect(blockerOf([formula({ code: 'DOC', formula: 'a254 * curve_slope', curve_slot: 'doc' })]))
			.toBe('the curve slot doc, whose coefficients are chosen per sample');
	});

	it('cannot, when a formula runs per replicate', () => {
		expect(blockerOf([formula({ code: 'SUVA', formula: 'a254 / DOC', per_replicate: 'DOC' })]))
			.toBe('SUVA, which runs per replicate of DOC');
	});
});

describe('renaming a formula', () => {
	// Scenario: an author renames output CO2_HS_Um while pCO2 reads it per replicate.
	// Expected behaviour: every whole-identifier use of the old code follows the rename, so the
	// reader keeps reading the formula rather than a catalog parameter of the old name.
	const renamed = () => [
		formula({ id: 'a', code: 'CO2_HS_Um2', formula: 'x * 2', ordinal: 1 }),
		formula({ id: 'b', code: 'pCO2', formula: 'CO2_HS_Um / kh + CO2_HS_Um_sd + xCO2_HS_Um', ordinal: 2, per_replicate: 'CO2_HS_Um' }),
		formula({ id: 'c', code: 'avg', formula: 'mean(CO2_HS_Um)*2', ordinal: 3 }),
	];

	it('rewrites every reader of the old code, expression and per-replicate field alike', () => {
		const set = renamed();
		carryRename(set, set[0]!, 'CO2_HS_Um');
		expect(set[1]!.formula).toBe('CO2_HS_Um2 / kh + CO2_HS_Um_sd + xCO2_HS_Um');
		expect(set[1]!.per_replicate).toBe('CO2_HS_Um2');
		expect(set[2]!.formula).toBe('mean(CO2_HS_Um2)*2');
	});

	it('carries a swap of two codes one rename at a time', () => {
		const set = [
			formula({ id: 'a', code: 'tmp', formula: '1', ordinal: 1 }),
			formula({ id: 'b', code: 'b', formula: '2', ordinal: 2 }),
			formula({ id: 'c', code: 'c', formula: 'a - b', ordinal: 3 }),
		];
		carryRename(set, set[0]!, 'a');
		set[1]!.code = 'a';
		carryRename(set, set[1]!, 'b');
		set[0]!.code = 'b';
		carryRename(set, set[0]!, 'tmp');
		expect(set[2]!.formula).toBe('b - a');
	});

	it('carries nothing to an empty code, a code that is not a name, or one another formula holds', () => {
		for (const code of ['', ' ', '2x', 'a b', 'pCO2']) {
			const set = renamed();
			set[0]!.code = code;
			carryRename(set, set[0]!, 'CO2_HS_Um');
			expect(set[1]!.formula).toBe('CO2_HS_Um / kh + CO2_HS_Um_sd + xCO2_HS_Um');
			expect(set[1]!.per_replicate).toBe('CO2_HS_Um');
		}
	});

	it('leaves a number with an exponent alone', () => {
		const set = [
			formula({ id: 'a', code: 'e6', formula: '1', ordinal: 1 }),
			formula({ id: 'b', code: 'b', formula: '2e5 * e5', ordinal: 2 }),
		];
		carryRename(set, set[0]!, 'e5');
		expect(set[1]!.formula).toBe('2e5 * e6');
	});
});

describe('the steps the picker offers', () => {
	const stored = (id: string, code: string, text: string, owner: string | null = null) =>
		({
			id,
			code,
			name: code,
			units: '',
			formula: text,
			ordinal: 0,
			tool_script_id: owner,
			intermediate: true,
		}) as unknown as DerivedParameter;
	const steps = [
		stored('f-1', 'water_k', 'WTW_Temp_degC_1 + 273.15', 'pco2'),
		stored('f-2', 'kh', '0.034 * exp(c_const * (1 / water_k - 1 / 298.15))', 'pco2'),
		stored('f-3', 'shared_k', 'Dissolved_O2'),
		stored('f-4', 'elsewhere', 'Dissolved_O2', 'other'),
		stored('f-5', 'reads_shared', 'shared_k * 2', 'pco2'),
	];
	const owners = new Map([['pco2', 'pco2real']]);

	it('names the owner and the owned step reading it brings along', () => {
		const [kh] = stepOffers([steps[1]], steps, owners);
		expect(kh.owner).toBe('pco2real');
		expect(kh.formula).toBe('0.034 * exp(c_const * (1 / water_k - 1 / 298.15))');
		expect(kh.chain).toEqual([{ code: 'water_k', formula: 'WTW_Temp_degC_1 + 273.15' }]);
		expect(kh.label).toBe('kh · pco2real · brings in 1 more step: water_k');
	});

	it('brings nothing along for a shared step, or one reading only shared steps', () => {
		const [shared, readsShared] = stepOffers([steps[2], steps[4]], steps, owners);
		expect(shared.label).toBe('shared_k · shared');
		expect(readsShared.chain).toEqual([]);
	});

	it('orders a deeper chain each step after the steps it reads', () => {
		const chain = [
			stored('a', 'a', 'Dissolved_O2', 'x'),
			stored('b', 'b', 'a + 1', 'x'),
			stored('c', 'c', 'b * a', 'x'),
		];
		const [c] = stepOffers([chain[2]], chain, new Map());
		expect(c.chain.map((s) => s.code)).toEqual(['a', 'b']);
		expect(c.label).toBe('c · another calculation · brings in 2 more steps: a, b');
	});
});
