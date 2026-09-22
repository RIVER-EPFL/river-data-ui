import { describe, expect, it } from 'vitest';

import { byCadence, coversCadence, openingTab, siteCadence } from './cadence';

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

describe('the cadence a site opens in', () => {
	const spot = { frequency: 'low', reading_count: 43 };
	const series = { frequency: 'high', reading_count: 8640 };
	const mixed = { frequency: 'mixed', reading_count: 12 };
	const empty = { frequency: 'low', reading_count: 0 };

	it('reads the cadence off the parameters that hold data', () => {
		expect(siteCadence([spot, spot, empty])).toBe('low');
		expect(siteCadence([series, series])).toBe('high');
		expect(siteCadence([spot, series])).toBe('all');
		expect(siteCadence([mixed])).toBe('all');
	});

	it('leaves a site with no data yet on the All default', () => {
		expect(siteCadence([])).toBe('all');
		expect(siteCadence([empty, { frequency: 'high', reading_count: null }])).toBe('all');
	});

	// VAD on dev: 90 parameters, every reading spot. The visits grid is where those values are.
	it('opens a spot-only site on its visits and everything else on its charts', () => {
		expect(openingTab(Array.from({ length: 90 }, () => spot))).toBe('visits');
		expect(openingTab([spot, series])).toBe('charts');
		expect(openingTab([series])).toBe('charts');
		expect(openingTab([])).toBe('charts');
	});
});
