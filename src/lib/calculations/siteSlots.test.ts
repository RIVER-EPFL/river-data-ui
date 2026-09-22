import { describe, expect, it } from 'vitest';

import type { ParameterGroup, ParameterGroupMember, SiteParameter } from '$api/crud';
import type { CalculationImpact } from '$api/service';
import {
	cadenceConsequence,
	cadenceLabel,
	calculationsBySlot,
	groupSlots,
	otherCadence
} from './siteSlots';

const slot = (parameter_id: string, over: Partial<SiteParameter> = {}) =>
	({ id: `sp-${parameter_id}`, parameter_id, entry_mode: 'manual', ...over }) as SiteParameter;

const member = (parameter_id: string, group_id: string, ordinal: number) =>
	({ parameter_id, group_id, ordinal }) as ParameterGroupMember;

const group = (id: string, label: string, ordinal: number) =>
	({ id, code: label.toLowerCase(), label, ordinal }) as ParameterGroup;

const impact = (tool: string, reads: string[], outputs: string[]): CalculationImpact => ({
	tool,
	label: tool,
	reads: reads.map((parameter_id) => ({ parameter_id, parameter_code: parameter_id })),
	outputs: outputs.map((parameter_id) => ({ parameter_id, parameter_code: parameter_id })),
});

const groups = [group('g-head', 'Headspace', 2), group('g-doc', 'Carbon', 1)];
const members = [
	member('p-temp', 'g-head', 1),
	member('p-pressure', 'g-head', 2),
	member('p-pco2', 'g-head', 3),
	member('p-doc', 'g-doc', 1),
];

describe('the site slots a group brought in', () => {
	it('lists the groups in their own order, columns in theirs, and slots in no group last', () => {
		const listed = groupSlots(
			[slot('p-loose'), slot('p-pco2'), slot('p-doc'), slot('p-temp')],
			members,
			groups,
		);
		expect(listed.map((g) => [g.label, g.slots.map((s) => s.parameter_id)])).toEqual([
			['Carbon', ['p-doc']],
			['Headspace', ['p-temp', 'p-pco2']],
			['No group', ['p-loose']],
		]);
	});

	it('leaves out a group the site holds no slot of', () => {
		const listed = groupSlots([slot('p-doc')], members, groups);
		expect(listed.map((g) => g.label)).toEqual(['Carbon']);
	});

	it('names on the group header every calculation publishing one of its slots, once', () => {
		const bySlot = calculationsBySlot(
			[impact('pco2_demo', ['p-temp', 'p-pressure'], ['p-pco2'])],
			new Map([['pco2_demo', 'tool-1']]),
		);
		const [headspace] = groupSlots([slot('p-temp'), slot('p-pco2')], members, groups, bySlot);
		expect(headspace.declared).toEqual([
			{ id: 'tool-1', name: 'pco2_demo', label: 'pco2_demo', writes: true },
		]);
	});
});

describe('the calculation over one slot', () => {
	it('chips an output with the calculation that publishes it and an input with the one reading it', () => {
		const bySlot = calculationsBySlot(
			[impact('pco2_demo', ['p-temp'], ['p-pco2'])],
			new Map([['pco2_demo', 'tool-1']]),
		);
		expect(bySlot.get('p-pco2')?.[0].writes).toBe(true);
		expect(bySlot.get('p-temp')?.[0].writes).toBe(false);
	});

	it('names a calculation that both reads and publishes a slot once, as its publisher', () => {
		const bySlot = calculationsBySlot(
			[impact('chain', ['p-pco2'], ['p-pco2'])],
			new Map([['chain', 'tool-2']]),
		);
		expect(bySlot.get('p-pco2')).toEqual([
			{ id: 'tool-2', name: 'chain', label: 'chain', writes: true },
		]);
	});

	it('leaves the id null where the name resolved to no calculation page', () => {
		const bySlot = calculationsBySlot([impact('doc', [], ['p-doc'])], new Map());
		expect(bySlot.get('p-doc')?.[0].id).toBeNull();
	});
});

describe('the cadence a slot declares', () => {
	it('is worded as the instrument toggle words it', () => {
		expect(cadenceLabel('low')).toBe('Low frequency');
		expect(cadenceLabel('high')).toBe('High frequency');
	});

	// The column defaults to 'high', so a slot that has never been declared reads as high rather
	// than as blank.
	it('reads an undeclared slot as high frequency', () => {
		expect(cadenceLabel(undefined)).toBe('High frequency');
		expect(otherCadence(undefined)).toBe('low');
	});

	it('offers the other cadence', () => {
		expect(otherCadence('low')).toBe('high');
		expect(otherCadence('high')).toBe('low');
	});

	it('says which engine each choice hands the slot to', () => {
		expect(cadenceConsequence('high')).toContain('at a visit');
		expect(cadenceConsequence('high')).toContain('chain');
		expect(cadenceConsequence('low')).toContain('continuous engine');
	});
});
