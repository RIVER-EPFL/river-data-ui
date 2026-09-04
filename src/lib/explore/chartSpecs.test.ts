import { describe, expect, it } from 'vitest';
import {
	decodeScatterSpecs,
	decodeTimeSeriesSpecs,
	encodeScatterSpecs,
	encodeTimeSeriesSpecs,
	type ScatterSpec,
	type TimeSeriesSpec,
} from './chartSpecs';

const scatter: ScatterSpec[] = [
	{ siteId: 'site-a', xParamId: 'p1', yParamId: 'p2', start: 1_700_000_000_000, end: 1_700_600_000_000 },
	{ siteId: 'site-b', xParamId: '', yParamId: 'p3', start: 0, end: 0 },
];

const timeSeries: TimeSeriesSpec[] = [
	{
		siteIds: ['site-a', 'site-b'],
		paramId: 'p1',
		resolution: 'daily',
		frequency: 'all',
		start: 1_700_000_000_000,
		end: 1_700_600_000_000,
	},
];

describe('chartSpecs', () => {
	it('round-trips scatter specs through the URL form', () => {
		expect(decodeScatterSpecs(encodeScatterSpecs(scatter))).toEqual(scatter);
	});

	it('round-trips time series specs through the URL form', () => {
		expect(decodeTimeSeriesSpecs(encodeTimeSeriesSpecs(timeSeries))).toEqual(timeSeries);
	});

	it('yields no specs for an absent or malformed param', () => {
		expect(decodeScatterSpecs(null)).toEqual([]);
		expect(decodeScatterSpecs('not json')).toEqual([]);
		expect(decodeScatterSpecs('{"s":"x"}')).toEqual([]);
		expect(decodeTimeSeriesSpecs('[1,2]')).toEqual([]);
	});

	it('drops entries of the wrong shape and coerces the rest', () => {
		const raw = JSON.stringify([{ s: 'site-a', x: 'p1', y: 'p2', f: '5', t: 9 }, { s: 3 }, 'junk']);
		expect(decodeScatterSpecs(raw)).toEqual([
			{ siteId: 'site-a', xParamId: 'p1', yParamId: 'p2', start: 0, end: 9 },
		]);
		const ts = JSON.stringify([{ s: ['site-a', 4], p: 'p1', r: 'weekly', q: 'nope' }]);
		expect(decodeTimeSeriesSpecs(ts)).toEqual([
			{ siteIds: ['site-a'], paramId: 'p1', resolution: 'hourly', frequency: 'high', start: 0, end: 0 },
		]);
	});

	it('encodes an empty layout as nothing, so the param is dropped', () => {
		expect(encodeScatterSpecs([])).toBe('');
		expect(encodeTimeSeriesSpecs([])).toBe('');
	});
});
