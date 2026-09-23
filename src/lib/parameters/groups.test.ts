import { describe, it, expect } from 'vitest';
import { ApiError } from '$api/client';
import {
	assignBody,
	assignmentError,
	groupApplyPreview,
	groupAppliedMessage,
	replicateSpec,
	replicated,
	roleLabel,
} from './groups';

const groups = [
	{ id: '11111111-1111-4111-8111-111111111111', code: 'field_data', label: 'Field data' },
	{ id: '22222222-2222-4222-8222-222222222222', code: 'nutrients', label: 'Nutrients' },
];

describe('assignmentError', () => {
	it('names the group a parameter already belongs to', () => {
		const refusal = new ApiError(
			400,
			'parameter already belongs to group 11111111-1111-4111-8111-111111111111',
		);
		expect(assignmentError(refusal, groups)).toBe(
			'parameter already belongs to group Field data (field_data)',
		);
	});

	it('leaves an unknown group id as it stands', () => {
		const refusal = new ApiError(
			400,
			'parameter already belongs to group 33333333-3333-4333-8333-333333333333',
		);
		expect(assignmentError(refusal, groups)).toContain('33333333-3333-4333-8333-333333333333');
	});

	it('unwraps a JSON error body', () => {
		const refusal = new ApiError(400, JSON.stringify({ error: 'group still has 3 members; move them out first' }));
		expect(assignmentError(refusal, groups)).toBe('group still has 3 members; move them out first');
	});
});

describe('roleLabel', () => {
	it('reads the stored values back as labels', () => {
		expect(roleLabel('measured')).toBe('Measured');
		expect(roleLabel('entry_only')).toBe('Entry only');
		expect(roleLabel('output')).toBe('Output');
	});
});

describe('the replicate declaration', () => {
	it('carries no count: the width belongs to the grid, not the definition', () => {
		expect(replicateSpec(true)).toEqual({});
		expect(replicateSpec(false)).toBeNull();
	});

	it('reads a declaration back, including a legacy spec that still carries a count', () => {
		expect(replicated({})).toBe(true);
		expect(replicated({ suggested: 2 })).toBe(true);
		expect(replicated(null)).toBe(false);
	});

	it('carries the declaration in the body a member is assigned with', () => {
		const group = '11111111-1111-4111-8111-111111111111';
		const parameter = '44444444-4444-4444-8444-444444444444';
		expect(assignBody(group, parameter, 3, true)).toEqual({
			group_id: group,
			parameter_id: parameter,
			ordinal: 3,
			replicates: {},
		});
		expect(assignBody(group, parameter, 3, false)).toEqual({
			group_id: group,
			parameter_id: parameter,
			ordinal: 3,
			replicates: null,
		});
	});
});

describe('groupApplyPreview', () => {
	const slot = (id: string, code: string, role: string) => ({
		parameter_id: id,
		parameter_code: code,
		role,
	});
	const names: Record<string, string> = { 'p-1': 'Headspace CO2', 'p-2': 'Headspace pCO2' };
	const nameOf = (id: string) => names[id] ?? null;

	it('lists what the apply would add and what the site already holds', () => {
		const preview = groupApplyPreview(
			{ created: [slot('p-1', 'hs_co2', 'measured')], existing: [slot('p-2', 'hs_pco2', 'output')] },
			nameOf,
		);
		expect(preview.adding).toEqual([
			{ parameterId: 'p-1', code: 'hs_co2', name: 'Headspace CO2', role: 'Measured' },
		]);
		expect(preview.held).toEqual([
			{ parameterId: 'p-2', code: 'hs_pco2', name: 'Headspace pCO2', role: 'Output' },
		]);
		expect(preview.applicable).toBe(true);
	});

	it('has nothing to apply when the site already holds every member', () => {
		const preview = groupApplyPreview(
			{ created: [], existing: [slot('p-2', 'hs_pco2', 'output')] },
			nameOf,
		);
		expect(preview.applicable).toBe(false);
	});

	it('falls back to the code for a parameter the page does not name', () => {
		const preview = groupApplyPreview({ created: [slot('p-9', 'hs_temp', 'entry_only')], existing: [] }, nameOf);
		expect(preview.adding[0]).toEqual({
			parameterId: 'p-9',
			code: 'hs_temp',
			name: 'hs_temp',
			role: 'Entry only',
		});
	});
});

describe('groupAppliedMessage', () => {
	const slot = (id: string, code: string) => ({ parameter_id: id, parameter_code: code, role: 'measured' });
	const names: Record<string, string> = { 'p-1': 'Depth', 'p-2': 'Temperature', 'p-3': 'Turbidity', 'p-4': 'CDOM' };
	const nameOf = (id: string) => names[id] ?? null;
	const promised = groupApplyPreview(
		{ created: [slot('p-1', 'depth'), slot('p-2', 'temp')], existing: [slot('p-3', 'turb')] },
		nameOf,
	);

	it('says only that the group applied when the write matches the preview', () => {
		const landed = groupApplyPreview(
			{ created: [slot('p-2', 'temp'), slot('p-1', 'depth')], existing: [slot('p-3', 'turb')] },
			nameOf,
		);
		expect(groupAppliedMessage(promised, landed)).toBe('Group applied');
	});

	it('names a slot someone else added between the preview and the write', () => {
		const landed = groupApplyPreview(
			{ created: [slot('p-2', 'temp')], existing: [slot('p-1', 'depth'), slot('p-3', 'turb')] },
			nameOf,
		);
		expect(groupAppliedMessage(promised, landed)).toBe(
			'1 added, not the 2 previewed: Depth was added by someone else',
		);
	});

	it('names a held slot someone else removed, which the write added back', () => {
		const landed = groupApplyPreview(
			{ created: [slot('p-1', 'depth'), slot('p-2', 'temp'), slot('p-3', 'turb')], existing: [] },
			nameOf,
		);
		expect(groupAppliedMessage(promised, landed)).toBe(
			'3 added, not the 2 previewed: Turbidity was removed by someone else and added back',
		);
	});

	it('names members that joined or left the group since the preview', () => {
		const landed = groupApplyPreview(
			{ created: [slot('p-1', 'depth'), slot('p-4', 'cdom')], existing: [slot('p-3', 'turb')] },
			nameOf,
		);
		expect(groupAppliedMessage(promised, landed)).toBe(
			'2 added, as many as previewed: CDOM joined the group since the preview; Temperature left the group since the preview',
		);
	});

	it('joins several names in one clause', () => {
		const landed = groupApplyPreview(
			{ created: [], existing: [slot('p-1', 'depth'), slot('p-2', 'temp'), slot('p-3', 'turb')] },
			nameOf,
		);
		expect(groupAppliedMessage(promised, landed)).toBe(
			'0 added, not the 2 previewed: Depth and Temperature were added by someone else',
		);
	});

	it('says only that the group applied when there was no preview to compare against', () => {
		const landed = groupApplyPreview({ created: [slot('p-1', 'depth')], existing: [] }, nameOf);
		expect(groupAppliedMessage(null, landed)).toBe('Group applied');
	});
});
