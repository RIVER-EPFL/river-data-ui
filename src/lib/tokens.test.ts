import { describe, expect, it } from 'vitest';
import { emptyTokenForm, tokenFormOf, tokenPayload } from './tokens';
import type { ApiToken } from '$api/crud';

describe('tokenPayload', () => {
	it('omits what a create has nothing to say about, the author included', () => {
		expect(tokenPayload('create', emptyTokenForm())).toEqual({
			name: '',
			permissions: { read_metadata: true, read_data: true, write_metadata: false, write_data: false },
		});
	});

	it('sends every field on an edit, so an expiry or a scope can be cleared', () => {
		expect(tokenPayload('edit', emptyTokenForm())).toEqual({
			name: '',
			permissions: { read_metadata: true, read_data: true, write_metadata: false, write_data: false },
			description: null,
			project_scope: null,
			rate_limit_per_second: null,
			expires_at: null,
		});
	});

	it('carries the typed values through both modes', () => {
		const form = {
			...emptyTokenForm(),
			name: 'Field logger',
			description: '  Martigny  ',
			projectScope: 'p1',
			rateLimit: '50',
			expiryMode: 'custom' as const,
			expiresAt: '2026-12-01T09:00:00Z',
		};
		const shared = {
			name: 'Field logger',
			description: 'Martigny',
			project_scope: 'p1',
			rate_limit_per_second: 50,
			expires_at: '2026-12-01T09:00:00Z',
		};
		expect(tokenPayload('create', form)).toMatchObject(shared);
		expect(tokenPayload('edit', form)).toMatchObject(shared);
	});

	it('treats a zero or blank rate limit as unlimited', () => {
		const form = { ...emptyTokenForm(), rateLimit: '0' };
		expect(tokenPayload('create', form)).not.toHaveProperty('rate_limit_per_second');
		expect(tokenPayload('edit', form).rate_limit_per_second).toBeNull();
	});
});

describe('tokenFormOf', () => {
	it('reads a stored token back into the form', () => {
		const token = {
			id: 't1',
			name: 'Field logger',
			description: null,
			permissions: { read_metadata: true, read_data: true, write_metadata: true, write_data: false },
			project_scope: 'p1',
			rate_limit_per_second: 10,
			expires_at: '2026-12-01T09:00:00Z',
			created_at: '2026-01-01T00:00:00Z',
		} satisfies ApiToken;
		expect(tokenFormOf(token)).toEqual({
			name: 'Field logger',
			description: '',
			projectScope: 'p1',
			permissions: { read_metadata: true, read_data: true, write_metadata: true, write_data: false },
			rateLimit: '10',
			expiryMode: 'custom',
			expiresAt: '2026-12-01T09:00:00Z',
		});
	});

	it('reads a token with no expiry as never', () => {
		const token = {
			id: 't2',
			name: 'Reader',
			permissions: { read_metadata: true, read_data: true, write_metadata: false, write_data: false },
			expires_at: null,
			created_at: '2026-01-01T00:00:00Z',
		} satisfies ApiToken;
		expect(tokenFormOf(token).expiryMode).toBe('never');
	});
});
