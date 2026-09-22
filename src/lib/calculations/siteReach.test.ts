import { describe, expect, it } from 'vitest';
import { rankByReach, reachNote } from './siteReach';

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
