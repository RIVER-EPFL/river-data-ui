import { describe, expect, it } from 'vitest';

import {
	byCadence,
	coversCadence,
	heldCadences,
	heldChoice,
	offeredCadences,
	openingTab,
	siteCadence,
} from './cadence';

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
	const empty = { frequency: 'low', reading_count: 0 };

	it('reads the cadence off what the parameters holding data declare', () => {
		expect(siteCadence([spot, spot, empty])).toBe('low');
		expect(siteCadence([series, series])).toBe('high');
	});

	// A site declaring both is a site whose slots disagree, not a slot reporting a third word.
	it('opens on All where the site declares both cadences', () => {
		expect(siteCadence([spot, series])).toBe('all');
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

describe('the cadence a site opens in, read off what its rows hold', () => {
	const spotDeclaredHigh = { frequency: 'high', reading_count: 43, has_spot: true, has_continuous: false };
	const logger = { frequency: 'high', reading_count: 8640, has_spot: false, has_continuous: true };
	const loggerDeclaredLow = { frequency: 'low', reading_count: 8640, has_spot: false, has_continuous: true };

	// Every CNET slot on dev before B472: declared high, holding grabs only.
	it('opens spot-only data declared high on Low and on the visits', () => {
		expect(siteCadence([spotDeclaredHigh, spotDeclaredHigh])).toBe('low');
		expect(openingTab([spotDeclaredHigh])).toBe('visits');
	});

	it('opens continuous-only data on High and on the charts, whatever the declaration', () => {
		expect(siteCadence([logger, loggerDeclaredLow])).toBe('high');
		expect(openingTab([loggerDeclaredLow])).toBe('charts');
	});

	it('opens a site holding both on All and on the charts', () => {
		expect(siteCadence([spotDeclaredHigh, logger])).toBe('all');
		expect(openingTab([spotDeclaredHigh, logger])).toBe('charts');
	});
});

describe('the cadences the chips offer', () => {
	it('offers only Low where only spot data is held', () => {
		const held = heldCadences([{ has_spot: true, has_continuous: false }]);
		expect(offeredCadences(held)).toEqual(['low']);
		expect(heldChoice('high', held)).toBe('low');
		expect(heldChoice('all', held)).toBe('low');
	});

	it('offers only High where only continuous data is held', () => {
		const held = heldCadences([{ has_continuous: true }]);
		expect(offeredCadences(held)).toEqual(['high']);
		expect(heldChoice('low', held)).toBe('high');
	});

	it('offers all three where both are held, and keeps the choice', () => {
		const held = heldCadences([{ has_continuous: true }, { has_spot: true }]);
		expect(offeredCadences(held)).toEqual(['high', 'low', 'all']);
		expect(heldChoice('low', held)).toBe('low');
	});

	it('leaves every chip live over a site holding nothing yet', () => {
		expect(offeredCadences(heldCadences([]))).toEqual(['high', 'low', 'all']);
	});
});

