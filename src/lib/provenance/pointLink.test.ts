import { describe, expect, it } from 'vitest';

import { readPointParams, writePointParams } from './pointLink';

describe('point link parameters', () => {
	it('round-trips a chart point through the query string', () => {
		const params = new URLSearchParams('tab=charts&start=2026-01-01T00:00:00.000Z');
		const point = { siteParameterId: 'sp-1', timeIso: '2026-07-14T09:00:00.000Z', measurementType: 'spot' as const };
		writePointParams(params, point);
		expect(params.get('point')).toBe('sp-1');
		expect(params.get('t')).toBe('2026-07-14T09:00:00.000Z');
		expect(params.get('mt')).toBe('spot');
		expect(params.get('start')).toBe('2026-01-01T00:00:00.000Z');
		expect(readPointParams(params)).toEqual(point);
	});

	it('clears all three when the record closes and leaves the rest alone', () => {
		const params = new URLSearchParams('point=sp-1&t=2026-07-14T09:00:00Z&mt=spot&tab=charts');
		writePointParams(params, null);
		expect(params.toString()).toBe('tab=charts');
	});

	it('reads nothing from an incomplete or malformed link', () => {
		expect(readPointParams(new URLSearchParams('point=sp-1'))).toBeNull();
		expect(readPointParams(new URLSearchParams('point=sp-1&t=yesterday&mt=spot'))).toBeNull();
		expect(readPointParams(new URLSearchParams('point=sp-1&t=2026-07-14T09:00:00Z&mt=daily'))).toBeNull();
	});

	it('normalises the instant to UTC ISO form', () => {
		const ref = readPointParams(new URLSearchParams('point=sp-1&t=2026-07-14T11:00:00%2B02:00&mt=continuous'));
		expect(ref?.timeIso).toBe('2026-07-14T09:00:00.000Z');
	});
});
