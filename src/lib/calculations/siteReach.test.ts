import { describe, expect, it } from 'vitest';
import { fullReach, rankByReach, reachNote, readSpan, visitsHoldingAll } from './siteReach';

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

describe('visitsHoldingAll', () => {
	const cell = (parameter_id: string, value: number | null, withdrawn = false) => ({
		parameter_id,
		value,
		withdrawn,
	});
	const visits = [
		{ id: 'both', cells: [cell('a', 1), cell('b', 2)] },
		{ id: 'one', cells: [cell('a', 1)] },
		{ id: 'empty', cells: [cell('a', 1), cell('b', null)] },
		{ id: 'withdrawn', cells: [cell('a', 1), cell('b', 2, true)] },
	];

	it('keeps only the visits holding a live value of every read parameter', () => {
		expect(visitsHoldingAll(visits, ['a', 'b']).map((v) => v.id)).toEqual(['both']);
	});

	it('keeps every visit when the set reads nothing from a site', () => {
		expect(visitsHoldingAll(visits, [])).toHaveLength(4);
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
