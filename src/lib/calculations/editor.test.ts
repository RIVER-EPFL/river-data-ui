import { describe, expect, it } from 'vitest';

import type { Constant, Parameter } from '$api/crud';
import {
	blankFormula,
	dependencyOrder,
	draftRunBody,
	inputRows,
	outputRows,
	parseReplicates,
	type EditableFormula,
} from './editor';

const formula = (over: Partial<EditableFormula>): EditableFormula => ({
	id: null,
	code: '',
	name: '',
	units: '',
	formula: '',
	ordinal: 0,
	curve_slot: '',
	per_replicate: '',
	intermediate: false,
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

	it('reads a replicate list with blanks as unmeasured repeats', () => {
		expect(parseReplicates('1 2 3')).toEqual([1, 2, 3]);
		expect(parseReplicates('1,,3')).toEqual([1, null, 3]);
		expect(parseReplicates('1; -; 3')).toEqual([1, null, 3]);
		expect(parseReplicates('')).toEqual([]);
	});
});
