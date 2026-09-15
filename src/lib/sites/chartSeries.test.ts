import { describe, expect, it } from 'vitest';
import type { AggregatesResponse, ReadingsResponse } from '$lib/api/types';
import {
	annotationsByParameter,
	continuousSeries,
	max,
	mean,
	mergeOriginLabels,
	min,
	nullPct,
	originLabelOf,
	sampleCurve,
	spotSeries,
	stddev,
} from './chartSeries';

const label = (id: string | null | undefined) => id ?? 'merged';

describe('series statistics', () => {
	it('ignores the gaps in a series', () => {
		const vals = [2, null, 4, null];
		expect(mean(vals)).toBe(3);
		expect(min(vals)).toBe(2);
		expect(max(vals)).toBe(4);
		expect(nullPct(vals)).toBe(50);
	});

	it('has no sd below two values, and uses the sample divisor above it', () => {
		expect(stddev([5, null])).toBeNull();
		// 2 and 4 about a mean of 3: sqrt(2) under n-1, 1 under n.
		expect(stddev([2, 4])).toBeCloseTo(Math.SQRT2, 12);
	});

	it('reports nothing for an empty series rather than zero', () => {
		expect(mean([])).toBeNull();
		expect(min([null])).toBeNull();
		expect(nullPct([])).toBe(0);
	});
});

describe('continuousSeries', () => {
	const raw = {
		times: ['2026-01-15T10:00:00Z'],
		parameters: [{ id: 'sp1', values: [4], flagged: [true], flag_reasons: ['drift'] }],
	} as unknown as ReadingsResponse;

	it('reads a raw response as one line per slot, carrying its flags', () => {
		const series = continuousSeries(raw, 'raw', false, label);
		expect(series.map.get('sp1')).toEqual({
			times: [new Date('2026-01-15T10:00:00Z').getTime() / 1000],
			values: [4],
			flags: [true],
			flagReasons: ['drift'],
		});
		expect(series.splits.size).toBe(0);
	});

	it('draws the first series of a split slot and keeps the rest beside it', () => {
		const aggregates = {
			times: ['2026-01-15T10:00:00Z'],
			parameters: [
				{ id: 'sp1', avg: [4], min: [3], max: [5], count: [2], sensor_id: 'A', flagged_count: [1] },
				{ id: 'sp1', avg: [9], min: [9], max: [9], count: [1], sensor_id: 'B' },
			],
		} as unknown as AggregatesResponse;
		const series = continuousSeries(aggregates, 'daily', true, label);
		expect(series.map.get('sp1')).toMatchObject({ values: [4], mins: [3], maxs: [5], flags: [true] });
		expect(series.firsts.get('sp1')).toBe('A');
		expect(series.splits.get('sp1')?.map((e) => e.label)).toEqual(['B']);
	});

	it('carries no split lines when the split is off', () => {
		const aggregates = {
			times: ['2026-01-15T10:00:00Z'],
			parameters: [{ id: 'sp1', avg: [4], min: [4], max: [4], count: [1], sensor_id: 'A' }],
		} as unknown as AggregatesResponse;
		expect(continuousSeries(aggregates, 'daily', false, label).splits.size).toBe(0);
	});

	it('reads an empty response as no series', () => {
		expect(continuousSeries(null, 'raw', false, label).map.size).toBe(0);
	});
});

describe('spotSeries', () => {
	const at = '2026-01-15T10:00:00Z';
	const response = {
		times: [at],
		parameters: [
			{
				id: 'sp1',
				parameter_id: 'par1',
				values: [412],
				withdrawn: [false],
				withdrawn_count: 3,
				calibration_ids: ['cal1'],
				standard_curve_ids: [null],
				samples: [
					{
						sample_id: 'sam1',
						n: 2,
						mean: 412.5,
						stdev: 0.5,
						min: 412,
						max: 413,
						sd_estimator: 'population',
						sd_estimator_source: 'slot',
						replicates: [
							{ replicate_index: 0, raw_value: 412, standard_curve_id: 'curveA', calibration_id: 'cal1' },
							{ replicate_index: 1, raw_value: 413, standard_curve_id: 'curveA', calibration_id: 'cal1' },
						],
					},
				],
			},
		],
	} as unknown as ReadingsResponse;

	it('keys the point statistics by the instant in epoch milliseconds', () => {
		const series = spotSeries(response);
		const point = series.stats.get('par1')?.get(new Date(at).getTime());
		expect(point).toMatchObject({
			mean: 412.5,
			n: 2,
			stdev: 0.5,
			sdEstimator: 'population',
			sampleId: 'sam1',
			withdrawn: false,
			calibrationId: 'cal1',
			standardCurveId: null,
		});
	});

	it('serves the replicate mean over the point value, and reports the retraction count', () => {
		const series = spotSeries(response);
		expect(series.map.get('sp1')?.values).toEqual([412]);
		expect(series.stats.get('par1')?.get(new Date(at).getTime())?.mean).toBe(412.5);
		expect(series.withdrawnCounts.get('par1')).toBe(3);
	});

	it('collects every curve reference the payload named, replicates included', () => {
		const series = spotSeries(response);
		expect(series.standardCurveIds).toEqual([null, 'curveA', 'curveA']);
		expect(series.calibrationIds).toEqual(['cal1', 'cal1', 'cal1']);
		expect(series.curves.get('sam1')).toMatchObject({ curveId: 'curveA', mixed: false });
	});

	it('reads an empty response as no series', () => {
		expect(spotSeries(null).stats.size).toBe(0);
	});
});

describe('sampleCurve', () => {
	it('reports a group whose replicates carry different curves rather than picking one', () => {
		const curve = sampleCurve({
			sample_id: 's',
			n: 2,
			sd_estimator: 'sample',
			sd_estimator_source: 'slot',
			replicates: [
				{ replicate_index: 0, raw_value: 1, standard_curve_id: 'a', flagged: false, withdrawn: false },
				{ replicate_index: 1, raw_value: 2, standard_curve_id: 'b', flagged: false, withdrawn: false },
			],
		});
		expect(curve).toMatchObject({ curveId: null, mixed: true });
	});

	it('reads a group with no curve at all as carrying none', () => {
		expect(
			sampleCurve({
				sample_id: 's',
				n: 1,
				sd_estimator: 'sample',
				sd_estimator_source: 'slot',
				replicates: [],
			}),
		).toMatchObject({ curveId: null, mixed: false });
	});
});

describe('origins and annotations', () => {
	it('names every distinct source a series arrived through', () => {
		expect(originLabelOf([{ source_system: 'cnet' }, { source_system: 'grab_sample' }])).toBe(
			'cnet sync + entered in the grid',
		);
		expect(originLabelOf(undefined)).toBe('');
	});

	it('keeps a label an earlier fetch carried where the new one has none', () => {
		const aggregates = { times: ['2026-01-15T10:00:00Z'], parameters: [] } as unknown as AggregatesResponse;
		const labels = mergeOriginLabels(new Map([['sp1', 'via cnet sync']]), [aggregates, null]);
		expect(labels.get('sp1')).toBe('via cnet sync');
	});

	it('groups annotations under the parameter they annotate', () => {
		const anns = [
			{ id: 'a', parameter_id: 'par1' },
			{ id: 'b', parameter_id: 'par1' },
			{ id: 'c', parameter_id: 'par2' },
		] as never;
		const byParam = annotationsByParameter(anns);
		expect(byParam.get('par1')).toHaveLength(2);
		expect(byParam.get('par2')).toHaveLength(1);
	});
});
