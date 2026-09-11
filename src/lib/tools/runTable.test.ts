import { describe, expect, it } from 'vitest';

import type { ToolOutput } from '$api/service';
import { runTables } from './runTable';

const output = (over: Partial<ToolOutput>): ToolOutput =>
	({ label: over.key, units: null, per_replicate: false, aggregate_of: null, ...over }) as ToolOutput;

// pCO2's shape: a step, a per-replicate output over two letters, and the statistics of that output.
const outputs = [
	output({ key: 'CO2_HS_Um_{rep}', label: 'CO2 HS', units: 'uM', per_replicate: true }),
	output({ key: 'CO2_HS_Um_avg', label: 'CO2 HS avg', units: 'uM', aggregate_of: 'CO2_HS_Um' }),
	output({ key: 'CO2_HS_Um_sd', label: 'CO2 HS sd', units: 'uM', aggregate_of: 'CO2_HS_Um' }),
];

describe('run tables', () => {
	it('pivots replicates into columns and bands the steps above what publishes', () => {
		const tables = runTables(
			{ bp: 950, CO2_HS_Um_A: 12.5, CO2_HS_Um_B: 13.5, CO2_HS_Um_avg: 13, CO2_HS_Um_sd: 0.7 },
			outputs,
		);
		expect(tables.columns).toEqual(['A', 'B']);
		// A key the manifest does not declare is a step: an intermediate saves nowhere, so no
		// output is declared for it.
		expect(tables.steps.map((r) => r.key)).toEqual(['bp']);
		expect(tables.outputs).toHaveLength(1);
		expect(tables.outputs[0]?.label).toBe('CO2 HS');
		expect(tables.outputs[0]?.cells.map((c) => c.value)).toEqual([12.5, 13.5]);
		expect(tables.statistics.map((r) => r.label)).toEqual(['CO2 HS avg', 'CO2 HS sd']);
	});

	it('shows a cell that never ran with the reason, rather than leaving it out', () => {
		const tables = runTables({ CO2_HS_Um_A: 12.5 }, outputs, [
			{ output: 'CO2_HS_Um_B', reason: 'no value for co2ppm (lab_co2_co2ppm_B)' },
		]);
		expect(tables.columns).toEqual(['A', 'B']);
		expect(tables.outputs[0]?.cells[1]).toEqual({
			value: null,
			skipped: 'no value for co2ppm (lab_co2_co2ppm_B)',
		});
	});

	it('gives a calculation that ran once a single column', () => {
		const tables = runTables({ doc: 4.2 }, [output({ key: 'doc', label: 'DOC', units: 'ppb' })]);
		expect(tables.columns).toEqual([]);
		expect(tables.outputs[0]?.cells).toEqual([{ value: 4.2, skipped: null }]);
	});

	it('reads a per-replicate list from the formula engine as one column per index', () => {
		const tables = runTables(
			{ S1: [2, null, 6], S2: 5 },
			[
				output({ key: 'S1', label: 'S1', per_replicate: true }),
				output({ key: 'S2', label: 'S2' }),
			],
		);
		expect(tables.columns).toEqual(['A', 'B', 'C']);
		expect(tables.outputs[0]?.cells.map((c) => c.value)).toEqual([2, null, 6]);
		expect(tables.outputs[1]?.cells[0]?.value).toBe(5);
	});

	it('bands from the trace and gives each cell its formula with what it read', () => {
		const tables = runTables(
			{ bp: 2, S1: [2, 6], S2: [12, 16] },
			[
				output({ key: 'S1', label: 'S1', per_replicate: true }),
				output({ key: 'S2', label: 'S2', per_replicate: true }),
			],
			[],
			[
				{
					code: 'bp',
					label: 'BP',
					units: 'hPa',
					formula: 'field_bp * 1.0',
					intermediate: true,
					per_replicate: false,
					cells: [{ value: 2, bindings: { field_bp: 2 } }],
				},
				{
					code: 'S1',
					label: 'S1',
					units: null,
					formula: 'peak * bp',
					intermediate: false,
					per_replicate: true,
					cells: [
						{ index: 0, value: 2, bindings: { peak: 1, bp: 2 } },
						{ index: 1, value: 6, bindings: { peak: 3, bp: 2 } },
					],
				},
				{
					code: 'S2',
					label: 'S2',
					units: null,
					formula: 's1 + k',
					intermediate: false,
					per_replicate: true,
					cells: [
						{ index: 0, value: 12, bindings: { s1: 2, k: 10 } },
						{ index: 1, value: 16, bindings: { s1: 6, k: 10 } },
					],
				},
			],
		);
		expect(tables.steps.map((r) => r.key)).toEqual(['bp']);
		expect(tables.steps[0]?.label).toBe('BP');
		expect(tables.steps[0]?.units).toBe('hPa');
		expect(tables.outputs.map((r) => r.key)).toEqual(['S1', 'S2']);
		// The stage-2 cell at B read the stage-1 value at B, and bp is a step it can open.
		const atB = tables.outputs[1]?.cells[1];
		expect(atB?.trace?.formula).toBe('s1 + k');
		expect(atB?.trace?.bindings).toEqual([
			{ name: 's1', value: 6, step: null },
			{ name: 'k', value: 10, step: null },
		]);
		expect(tables.outputs[0]?.cells[0]?.trace?.bindings).toContainEqual({
			name: 'bp',
			value: 2,
			step: 'bp',
		});
		// The scalar step's one cell has its own trace.
		expect(tables.steps[0]?.cells[0]?.trace?.bindings).toEqual([
			{ name: 'field_bp', value: 2, step: null },
		]);
	});

	it('leaves a cell without a trace as a plain number', () => {
		const tables = runTables({ doc: 4.2 }, [output({ key: 'doc', label: 'DOC', units: 'ppb' })]);
		expect(tables.outputs[0]?.cells[0]?.trace).toBeUndefined();
	});
});
