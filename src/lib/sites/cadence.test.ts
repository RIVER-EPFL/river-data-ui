import { describe, expect, it } from 'vitest';

import { byCadence, coversCadence } from './cadence';

const sensor = { id: 'sensor', has_continuous: true, has_spot: false };
const grab = { id: 'grab', has_continuous: false, has_spot: true };
const both = { id: 'both', has_continuous: true, has_spot: true };
const unknown = { id: 'unknown' };

const extents = new Map([
	['sensor', sensor],
	['grab', grab],
	['both', both]
]);
const params = [sensor, grab, both, unknown];
const split = (frequency: 'high' | 'low' | 'all') =>
	byCadence(params, (p) => extents.get(p.id), frequency);

describe('cadence filtering', () => {
	it('keeps only what a cadence holds', () => {
		expect(coversCadence(sensor, 'high')).toBe(true);
		expect(coversCadence(sensor, 'low')).toBe(false);
		expect(coversCadence(grab, 'low')).toBe(true);
		expect(coversCadence(grab, 'high')).toBe(false);
		expect(coversCadence(both, 'high')).toBe(true);
		expect(coversCadence(both, 'low')).toBe(true);
	});

	it('keeps every parameter when no cadence is chosen', () => {
		expect(split('all').shown.map((p) => p.id)).toEqual(['sensor', 'grab', 'both', 'unknown']);
		expect(split('all').hidden).toBe(0);
	});

	it('keeps a parameter the site detail does not describe, rather than hiding it unseen', () => {
		expect(coversCadence(undefined, 'low')).toBe(true);
		expect(split('low').shown.map((p) => p.id)).toEqual(['grab', 'both', 'unknown']);
	});

	it('counts what it left out, so the shrink can be stated', () => {
		expect(split('high').shown.map((p) => p.id)).toEqual(['sensor', 'both', 'unknown']);
		expect(split('high').hidden).toBe(1);
		expect(split('low').hidden).toBe(1);
	});
});
