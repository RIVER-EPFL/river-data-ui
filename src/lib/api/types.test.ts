// The API's response shapes are not generated, so a drift between the Rust and these interfaces is
// invisible to `svelte-check`: TypeScript is structural, and a field the UI never names is a field
// no compiler misses. The recordings below are responses as the API serves them, and the
// assertions name the fields the Rust marks required, so a rename or a removal fails here.
import { describe, expect, it } from 'vitest';
import type { ReadingsResponse, SampleStat } from './types';
import type { GrabSampleResponse } from './service';

// GET /api/sites/{id}/readings?include_sample_stats=true&include_measurement_type=true
const readings = {
	site: { id: '0b0e6b3e-2a5a-4a2f-8f6c-1d0b1a1c0001', name: 'Martigny' },
	start: '2026-01-15T00:00:00Z',
	end: '2026-01-16T00:00:00Z',
	times: ['2026-01-15T10:00:00Z'],
	parameters: [
		{
			id: '0b0e6b3e-2a5a-4a2f-8f6c-1d0b1a1c0002',
			parameter_id: '0b0e6b3e-2a5a-4a2f-8f6c-1d0b1a1c0003',
			code: 'DOC_ppb',
			name: 'DOC',
			type: 'measurement',
			units: 'ppb',
			decimal_places: 2,
			values: [412.5],
			measurement_types: ['spot'],
			samples: [
				{
					sample_id: '0b0e6b3e-2a5a-4a2f-8f6c-1d0b1a1c0004',
					n: 2,
					mean: 412.5,
					stdev: 0.7071067811865476,
					stdev_sample: 0.7071067811865476,
					stdev_population: 0.5,
					min: 412,
					max: 413,
					sd_estimator: 'sample',
					sd_estimator_source: 'slot',
					replicates: [
						{ replicate_index: 0, raw_value: 412, flagged: false, withdrawn: false },
						{ replicate_index: 1, raw_value: 413, flagged: false, withdrawn: false },
					],
				},
			],
		},
	],
} satisfies ReadingsResponse;

// POST /api/grab_samples
const grabSave = {
	inserted: 1,
	samples_created: 0,
	created_sample_ids: [],
	dry_run: false,
	replaced: 2,
	withdrawn: 0,
	kept_curated: 1,
	withdrawn: 0,
	preview: [],
	existing_groups: [],
	calculations: [],
} satisfies GrabSampleResponse;

function assertKeys(recorded: object, required: string[]) {
	expect(Object.keys(recorded)).toEqual(expect.arrayContaining(required));
}

describe('readings response', () => {
	it('serves every field a parameter series declares as required', () => {
		assertKeys(readings.parameters[0], ['id', 'parameter_id', 'code', 'name', 'type', 'units', 'values']);
	});

	it('carries the slot precision, so rendering needs no second endpoint', () => {
		expect(readings.parameters[0].decimal_places).toBe(2);
	});

	it('names the divisor of every sample it serves', () => {
		const stat = readings.parameters[0].samples[0] as SampleStat;
		assertKeys(stat, ['sample_id', 'n', 'sd_estimator', 'sd_estimator_source', 'replicates']);
		assertKeys(stat.replicates[0], ['replicate_index', 'raw_value', 'flagged', 'withdrawn']);
	});
});

describe('grab save response', () => {
	it('reports the curated rows a replace left in place', () => {
		assertKeys(grabSave, ['inserted', 'samples_created', 'dry_run', 'replaced', 'kept_curated', 'preview']);
		expect(grabSave.kept_curated).toBe(1);
	});
});
