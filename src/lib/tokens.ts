import type { ApiToken, TokenPermissions } from '$api/crud';

/**
 * The fields the token form edits. `rateLimit` is the raw input string, `expiresAt` the instant
 * the timestamp control resolved, and `expiryMode` what the preset chips set.
 */
export interface TokenFormState {
	name: string;
	description: string;
	projectScope: string;
	permissions: TokenPermissions;
	rateLimit: string;
	expiryMode: 'never' | 'custom';
	expiresAt: string;
}

export const emptyTokenForm = (): TokenFormState => ({
	name: '',
	description: '',
	projectScope: '',
	permissions: { read_metadata: true, read_data: true, write_metadata: false, write_data: false },
	rateLimit: '',
	expiryMode: 'never',
	expiresAt: '',
});

/** The stored token as the form reads it back. */
export function tokenFormOf(token: ApiToken): TokenFormState {
	const form = emptyTokenForm();
	return {
		...form,
		name: token.name,
		description: token.description ?? '',
		projectScope: token.project_scope ?? '',
		permissions: { ...form.permissions, ...token.permissions },
		rateLimit: token.rate_limit_per_second ? String(token.rate_limit_per_second) : '',
		expiryMode: token.expires_at ? 'custom' : 'never',
		expiresAt: token.expires_at ?? '',
	};
}

/**
 * What each mode sends. A create omits what it has nothing to say about, so the API's own defaults
 * apply; an edit sends every field, `null` included, because an omitted field would leave the
 * stored value in place and there would be no way to clear an expiry or a scope.
 *
 * `permissions` travels as an object: the API parses it as TokenPermissions and an array would
 * silently fall back to defaults.
 */
export function tokenPayload(
	mode: 'create' | 'edit',
	form: TokenFormState,
	createdBy = '',
): Record<string, unknown> {
	const rate = form.rateLimit && Number(form.rateLimit) > 0 ? Number(form.rateLimit) : null;
	const expiry = form.expiryMode === 'custom' && form.expiresAt ? form.expiresAt : null;
	const description = form.description.trim() || null;
	const scope = form.projectScope || null;

	if (mode === 'edit') {
		return {
			name: form.name,
			permissions: form.permissions,
			description,
			project_scope: scope,
			rate_limit_per_second: rate,
			expires_at: expiry,
		};
	}

	const payload: Record<string, unknown> = {
		name: form.name,
		permissions: form.permissions,
		created_by: createdBy,
	};
	if (description) payload.description = description;
	if (scope) payload.project_scope = scope;
	if (rate) payload.rate_limit_per_second = rate;
	if (expiry) payload.expires_at = expiry;
	return payload;
}
