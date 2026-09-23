import { describe, expect, it } from 'vitest';

import type { SiteParameter } from '$api/crud';
import type { SlotCalculation, SlotGroup } from '$lib/calculations/siteSlots';
import {
	NO_FILTER,
	filterSlotGroups,
	intervalLabel,
	isCalculatedSlot,
	isFiltering,
	slotConfiguration,
} from './slotTable';

const slot = (parameter_id: string, over: Partial<SiteParameter> = {}) =>
	({ id: `sp-${parameter_id}`, parameter_id, entry_mode: 'manual', cadence: 'low', ...over }) as SiteParameter;

const NAMES: Record<string, { code: string; name: string }> = {
	'p-do': { code: 'DO', name: 'Dissolved oxygen' },
	'p-do-sat': { code: 'DO_sat', name: 'Dissolved oxygen saturation' },
	'p-temp': { code: 'temp', name: 'Water temperature' },
	'p-pco2': { code: 'pCO2', name: 'pCO2' },
};
const names = (id: string) => NAMES[id];

const publishes = (name: string): SlotCalculation => ({ id: name, name, label: name, writes: true });
const reads = (name: string): SlotCalculation => ({ id: name, name, label: name, writes: false });

const groups: SlotGroup[] = [
	{
		id: 'g-head',
		code: 'head',
		label: 'Headspace',
		slots: [slot('p-temp', { cadence: 'high' }), slot('p-pco2', { needs_review: true })],
		declared: [],
	},
	{ id: null, code: null, label: 'No group', slots: [slot('p-do'), slot('p-do-sat')], declared: [] },
];
const bySlot = new Map([
	['p-pco2', [publishes('headspace')]],
	['p-temp', [reads('headspace')]],
]);

const codes = (left: SlotGroup[]) => left.flatMap((g) => g.slots.map((s) => names(s.parameter_id).code));

describe('the configuration cell', () => {
	it('reads units, interval, decimals and instrument on one line', () => {
		expect(
			slotConfiguration({ units: 'mg/L', intervalSec: 600, decimals: 2, instrument: 'WTW 3430' }),
		).toBe('mg/L · 10 min · 2 dp · WTW 3430');
	});

	it('leaves out what the slot does not set, and is empty when it sets nothing', () => {
		expect(slotConfiguration({ units: 'µS/cm', decimals: 0 })).toBe('µS/cm · 0 dp');
		expect(slotConfiguration({ units: ' ', intervalSec: null })).toBe('');
	});

	it('words an interval in its largest whole unit', () => {
		expect(intervalLabel(30)).toBe('30 s');
		expect(intervalLabel(3600)).toBe('1 h');
		expect(intervalLabel(86400)).toBe('1 d');
		expect(intervalLabel(0)).toBeNull();
		expect(intervalLabel(null)).toBeNull();
	});
});

describe('finding a slot', () => {
	it('leaves every group as it is with no filter', () => {
		expect(isFiltering(NO_FILTER)).toBe(false);
		expect(filterSlotGroups(groups, NO_FILTER, names, bySlot)).toBe(groups);
	});

	it('matches the query on code or name, whatever the case', () => {
		expect(codes(filterSlotGroups(groups, { ...NO_FILTER, query: 'do' }, names, bySlot))).toEqual([
			'DO',
			'DO_sat',
		]);
		expect(codes(filterSlotGroups(groups, { ...NO_FILTER, query: 'water' }, names, bySlot))).toEqual([
			'temp',
		]);
	});

	it('lists only calculation outputs under Calculated, not the inputs a calculation reads', () => {
		const tool = { ...groups[1], slots: [slot('p-do-sat', { entry_mode: 'tool' })] };
		const left = filterSlotGroups([groups[0], tool], { ...NO_FILTER, calculated: true }, names, bySlot);
		expect(codes(left)).toEqual(['pCO2', 'DO_sat']);
		expect(isCalculatedSlot(slot('p-temp'), bySlot)).toBe(false);
	});

	it('narrows to slots needing review, to a cadence and to one group, dropping emptied groups', () => {
		expect(codes(filterSlotGroups(groups, { ...NO_FILTER, needsReview: true }, names, bySlot))).toEqual([
			'pCO2',
		]);
		expect(codes(filterSlotGroups(groups, { ...NO_FILTER, cadence: 'high' }, names, bySlot))).toEqual([
			'temp',
		]);
		const ungrouped = filterSlotGroups(groups, { ...NO_FILTER, group: 'ungrouped' }, names, bySlot);
		expect(ungrouped.map((g) => g.label)).toEqual(['No group']);
		expect(filterSlotGroups(groups, { ...NO_FILTER, query: 'zzz' }, names, bySlot)).toEqual([]);
	});
});
