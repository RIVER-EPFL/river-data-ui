import { describe, expect, it } from 'vitest';
import type { RunTraceStep } from '$api/service';
import { equationChain, inputOrigin } from './equation';

// pco2_demo's shape: two steps feeding a per-replicate output, one of them per-replicate itself.
const trace: RunTraceStep[] = [
	{
		code: 'lab_temp_k',
		label: 'Lab temperature',
		units: 'K',
		output_parameter_code: null,
		formula: 'lab_temp + 273.15',
		intermediate: true,
		per_replicate: false,
		cells: [{ value: 293.15, bindings: { lab_temp: 20 } }],
	},
	{
		code: 'co2_dry_ppm',
		label: 'CO2 dry',
		units: 'ppm',
		output_parameter_code: null,
		formula: 'co2_wet / (1 - h2o)',
		intermediate: true,
		per_replicate: true,
		cells: [
			{ index: 0, value: 400, bindings: { co2_wet: 396, h2o: 0.01 } },
			{ index: 1, value: 505, bindings: { co2_wet: 499.95, h2o: 0.01 } },
		],
	},
	{
		code: 'pco2',
		label: 'pCO2',
		units: 'uatm',
		output_parameter_code: 'pco2_uatm',
		formula: 'co2_dry_ppm * lab_temp_k / 293.15',
		intermediate: false,
		per_replicate: true,
		cells: [
			{ index: 0, value: 400, bindings: { co2_dry_ppm: 400, lab_temp_k: 293.15 } },
			{ index: 1, value: 505, bindings: { co2_dry_ppm: 505, lab_temp_k: 293.15 } },
		],
	},
];

describe('equationChain', () => {
	it('opens one cell with each variable it read, marking the ones a step produced', () => {
		const chain = equationChain(trace, 'pco2', 1);
		expect(chain).toHaveLength(1);
		expect(chain[0]?.formula).toBe('co2_dry_ppm * lab_temp_k / 293.15');
		expect(chain[0]?.value).toBe(505);
		expect(chain[0]?.bindings).toEqual([
			{ name: 'co2_dry_ppm', value: 505, step: 'co2_dry_ppm' },
			{ name: 'lab_temp_k', value: 293.15, step: 'lab_temp_k' },
		]);
	});

	it('finds the step by the catalog parameter it writes, which is what a visit cell holds', () => {
		expect(equationChain(trace, 'PCO2_UATM', 0)[0]?.code).toBe('pco2');
	});

	it('walks down through the steps at the same index until it reaches the inputs', () => {
		const chain = equationChain(trace, 'pco2_uatm', 1, true);
		expect(chain.map((s) => s.key)).toEqual(['pco2:1', 'co2_dry_ppm:1', 'lab_temp_k:']);
		// co2_dry_ppm at B read B's wet value, not A's.
		expect(chain[1]?.bindings).toContainEqual({ name: 'co2_wet', value: 499.95, step: null });
		expect(chain[2]?.bindings).toEqual([{ name: 'lab_temp', value: 20, step: null }]);
	});

	it('opens nothing for a code no step produced, or a cell that did not run', () => {
		expect(equationChain(trace, 'doc_ppb', null)).toEqual([]);
		const skipped: RunTraceStep[] = [
			{ ...trace[0]!, cells: [{ value: null, skipped: 'lab_temp missing', bindings: {} }] },
		];
		expect(equationChain(skipped, 'lab_temp_k', null)).toEqual([]);
	});
});

describe('inputOrigin', () => {
	const origin = inputOrigin(
		{
			collected_at: '2025-07-02T08:00:00Z',
			event_inputs: [{ param: 'co2_wet', parameter_code: 'CO2_wet_ppm', value: 396 }],
			site_inputs: [{ property: 'altitude', param: 'alt', value: 1200 }],
			constants: { R: 8.314 },
		},
		(iso) => iso.slice(0, 10),
	);

	it('names the reading and the visit a value was read at', () => {
		expect(origin('co2_wet')).toBe('CO2_wet_ppm, visit 2025-07-02');
	});

	it('names a site property, a constant, and otherwise a value the person entered', () => {
		expect(origin('alt')).toBe('site altitude');
		expect(origin('R')).toBe('constant');
		expect(origin('lab_temp')).toBe('entered');
	});
});
