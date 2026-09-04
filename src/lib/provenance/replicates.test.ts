import { describe, expect, it } from 'vitest';

import type { ProvenanceRecord } from '$api/service';
import { replicatesOf } from './replicates';

function record(readings: ProvenanceRecord['readings']): ProvenanceRecord {
	return {
		origin: { stream_id: 's', source_system: 'cnet', source_key: 'k', classification: 'sync' },
		readings,
		chain: {},
		holds: [],
	};
}

describe('replicatesOf', () => {
	it('carries index, both values, both curve ids and the curation state of every replicate', () => {
		const reps = replicatesOf(
			record([
				{
					replicate_index: 0,
					raw_value: 41.2,
					calibrated_value: 42.1,
					is_flagged: false,
					calibration: { id: 'cal-1', slope: 1, intercept: 0, valid_from: '2026-01-01T00:00:00Z' },
					standard_curve: { id: 'curve-9', sensor_id: 'lab', slope: 2, intercept: 1 },
				},
				{ replicate_index: 1, raw_value: 41.4, is_flagged: true, flag_reason: 'outlier' },
				{ replicate_index: 2, raw_value: 62, is_flagged: false, withdrawn_at: '2026-07-15T04:00:00Z' },
			]),
		);
		expect(reps).toEqual([
			{
				replicate_index: 0,
				raw_value: 41.2,
				calibrated_value: 42.1,
				calibration_id: 'cal-1',
				standard_curve_id: 'curve-9',
				flagged: false,
				withdrawn: false,
			},
			{
				replicate_index: 1,
				raw_value: 41.4,
				calibrated_value: null,
				calibration_id: null,
				standard_curve_id: null,
				flagged: true,
				withdrawn: false,
			},
			{
				replicate_index: 2,
				raw_value: 62,
				calibrated_value: null,
				calibration_id: null,
				standard_curve_id: null,
				flagged: false,
				withdrawn: true,
			},
		]);
	});

	it('orders by replicate index whatever order the record lists them in', () => {
		const reps = replicatesOf(
			record([
				{ replicate_index: 2, raw_value: 3, is_flagged: false },
				{ replicate_index: 0, raw_value: 1, is_flagged: false },
			]),
		);
		expect(reps.map((r) => r.replicate_index)).toEqual([0, 2]);
	});
});
