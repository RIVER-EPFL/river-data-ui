import { describe, it, expect } from 'vitest';
import { ApiError } from '$api/client';
import { assignmentError, roleLabel } from './groups';

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
