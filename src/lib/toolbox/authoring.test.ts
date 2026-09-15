import { describe, expect, it } from 'vitest';

import { ApiError } from '$api/client';
import { AUTHORING_REFUSED, authoringState, loadCatalog } from './authoring';

describe('the authoring catalog', () => {
	it('loads what the caller may read', async () => {
		const loaded = await loadCatalog(async () => [{ id: 'a' }]);
		expect(loaded).toEqual({ status: 'loaded', items: [{ id: 'a' }] });
	});

	it('reads a refusal as a refusal, not as an empty catalog', async () => {
		const refused = await loadCatalog(async () => {
			throw new ApiError(403, 'Forbidden');
		});
		expect(refused).toEqual({ status: 'refused' });
	});

	it('keeps a load failure distinct from a refusal', async () => {
		const failed = await loadCatalog<{ id: string }>(async () => {
			throw new Error('network down');
		});
		expect(failed).toEqual({ status: 'failed', message: 'network down' });
	});

	it('says the caller may not author, whether the role or the API says so', () => {
		expect(authoringState({ permitted: false, refused: false })).toEqual({
			authorable: false,
			notice: AUTHORING_REFUSED,
		});
		expect(authoringState({ permitted: true, refused: true })).toEqual({
			authorable: false,
			notice: AUTHORING_REFUSED,
		});
		expect(authoringState({ permitted: true, refused: false })).toEqual({
			authorable: true,
		});
	});
});
