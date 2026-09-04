import { describe, it, expect } from 'vitest';
import { buildReadingsExportParams, exportColumns, type ReadingsExportOptions } from './exportParams';

const base: ReadingsExportOptions = {
	startMs: Date.UTC(2025, 0, 1),
	endMs: Date.UTC(2025, 11, 31),
	parameterIds: [],
	format: 'csv',
	resolution: 'raw',
	includeFlagged: true,
	measurementType: 'all',
};

describe('buildReadingsExportParams', () => {
	it('asks for the sample statistics on a spot export', () => {
		const params = buildReadingsExportParams({ ...base, measurementType: 'spot' });
		expect(params.get('measurement_type')).toBe('spot');
		expect(params.get('include_sample_stats')).toBe('true');
		expect(params.get('include_curves')).toBe('true');
	});

	it('asks for them on an unfiltered export, which carries the spot instants too', () => {
		expect(buildReadingsExportParams(base).get('include_sample_stats')).toBe('true');
	});

	it('leaves them off a continuous export, where every instant is one value', () => {
		const params = buildReadingsExportParams({ ...base, measurementType: 'continuous' });
		expect(params.get('include_sample_stats')).toBeNull();
		expect(params.get('include_curves')).toBeNull();
	});

	it('never asks for replicate rows: they are their own download', () => {
		const params = buildReadingsExportParams({ ...base, measurementType: 'spot' });
		expect(params.get('include_replicates')).toBeNull();
	});

	it('leaves an aggregate export with the range and format alone', () => {
		const params = buildReadingsExportParams({ ...base, resolution: 'hourly' });
		expect(params.get('format')).toBe('csv');
		expect(params.get('include_flagged')).toBeNull();
		expect(params.get('include_sample_stats')).toBeNull();
	});

	it('asks for the flag columns only where the format has columns', () => {
		expect(buildReadingsExportParams(base).get('include_flags')).toBe('true');
		expect(buildReadingsExportParams({ ...base, format: 'json' }).get('include_flags')).toBeNull();
	});

	it('carries the selected parameters and the range', () => {
		const params = buildReadingsExportParams({ ...base, parameterIds: ['a', 'b'] });
		expect(params.get('parameter_ids')).toBe('a,b');
		expect(params.get('start')).toBe('2025-01-01T00:00:00.000Z');
	});
});

describe('exportColumns', () => {
	it('names the value column by the parameter code', () => {
		const columns = exportColumns(['DOC'], { ...base, measurementType: 'continuous' });
		expect(columns).toEqual(['time', 'DOC', 'DOC_flagged', 'DOC_flag_reason']);
	});

	it('lists the statistics and curve columns a spot export adds', () => {
		const columns = exportColumns(['DOC'], {
			...base,
			measurementType: 'spot',
			includeFlagged: false,
		});
		expect(columns).toEqual([
			'time',
			'DOC',
			'DOC_calibration_id',
			'DOC_standard_curve_id',
			'DOC_sample_id',
			'DOC_n',
			'DOC_mean',
			'DOC_sd',
			'DOC_min',
			'DOC_max',
		]);
	});

	it('is the time column and the codes for an aggregate export', () => {
		const columns = exportColumns(['DOC', 'CDOM'], { ...base, resolution: 'daily' });
		expect(columns).toEqual(['time', 'DOC', 'CDOM']);
	});
});
