import { describe, expect, it } from 'vitest';
import { fullReach, rankByReach, reachNote, readSpan, offeredSites } from './siteReach';

const sites = [
	{ id: 'a', name: 'Aproz', availableParamNames: ['temp'] },
	{ id: 'v', name: 'Verbier', availableParamNames: ['temp', 'press'] },
	{ id: 'm', name: 'Martigny', availableParamNames: ['temp', 'press'] },
	{ id: 's', name: 'Saxon', availableParamNames: [] },
];

describe('rankByReach', () => {
	it('puts the sites measuring most of the set first, then orders them by name', () => {
		expect(rankByReach(sites, ['temp', 'press']).map((r) => r.id)).toEqual(['m', 'v', 'a', 's']);
	});

	it('counts each parameter once, however often the set names it', () => {
		const [first] = rankByReach(sites, ['temp', 'temp', 'press']);
		expect(first).toMatchObject({ measured: 2, total: 2 });
	});

	it('counts a site whose parameters are unknown as measuring everything', () => {
		const [only] = rankByReach([{ id: 'u', name: 'Unknown' }], ['temp', 'press']);
		expect(only).toMatchObject({ measured: 2, total: 2 });
	});
});

describe('reachNote', () => {
	it('says a site measures the whole set', () => {
		expect(reachNote({ id: 'm', name: 'Martigny', measured: 2, total: 2 })).toBe('measures all 2');
	});

	it('says how much of it a site measures otherwise', () => {
		expect(reachNote({ id: 'a', name: 'Aproz', measured: 1, total: 2 })).toBe('measures 1 of 2');
	});

	it('says nothing about a set that reads nothing from a site', () => {
		expect(reachNote({ id: 'a', name: 'Aproz', measured: 0, total: 0 })).toBe('');
	});
});

describe('fullReach', () => {
	it('keeps only the sites measuring everything the set reads, in reach order', () => {
		expect(fullReach(rankByReach(sites, ['temp', 'press'])).map((r) => r.id)).toEqual(['m', 'v']);
	});

	it('keeps every site when the set reads nothing from a site', () => {
		expect(fullReach(rankByReach(sites, []))).toHaveLength(4);
	});
});

describe('offeredSites', () => {
	const declaring = fullReach(rankByReach(sites, ['temp']));
	const counts = [
		{ site_id: 'v', visits: 2 },
		{ site_id: 'a', visits: 5 },
	];

	it('offers only the sites with a visit the set runs at, most visits first', () => {
		expect(offeredSites(sites, declaring, counts, false)).toEqual([
			{ id: 'a', name: 'Aproz', note: '5 visits' },
			{ id: 'v', name: 'Verbier', note: '2 visits' },
		]);
	});

	it('follows them with the other declaring sites for a set that also draws over streams', () => {
		expect(offeredSites(sites, declaring, counts, true).map((c) => [c.id, c.note])).toEqual([
			['a', '5 visits'],
			['v', '2 visits'],
			['m', 'no visit holds every input'],
		]);
	});

	it('offers the declaring sites when there are no counts', () => {
		expect(offeredSites(sites, declaring, null, false).map((c) => [c.id, c.note])).toEqual([
			['a', 'measures all 1'],
			['m', 'measures all 1'],
			['v', 'measures all 1'],
		]);
	});
});

describe('readSpan', () => {
	const extents = [
		{ code: 'temp', data_start: '2024-03-01T00:00:00Z', data_end: '2025-06-01T00:00:00Z' },
		{ code: 'press', data_start: '2023-01-01T00:00:00Z', data_end: '2024-01-01T00:00:00Z' },
		{ code: 'cond', data_start: '2020-01-01T00:00:00Z', data_end: '2026-01-01T00:00:00Z' },
		{ code: 'ph', data_start: null, data_end: null },
	];

	it('spans the earliest start to the latest end of the read parameters alone', () => {
		expect(readSpan(extents, ['temp', 'press'])).toEqual({
			start: '2023-01-01T00:00:00.000Z',
			end: '2025-06-01T00:00:00.000Z',
		});
	});

	it('is null when no read parameter holds data at the site', () => {
		expect(readSpan(extents, ['ph', 'doc'])).toBeNull();
	});
});
