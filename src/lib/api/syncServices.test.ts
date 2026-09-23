import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$auth/keycloak.svelte', () => ({
	auth: { token: 'tok', ensureToken: async () => {} },
}));

const { setSyncInterval, setFullReassert } = await import('./service');

function respond(body: unknown) {
	const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
		ok: true,
		status: 200,
		statusText: 'ok',
		headers: new Headers(),
		json: async () => body,
		text: async () => JSON.stringify(body),
	}));
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

beforeEach(() => vi.unstubAllGlobals());

describe('sync service settings', () => {
	it('sets the cadence with a PUT on the sync_services row', async () => {
		const f = respond({ id: 's1', sync_interval_secs: 3600 });
		await setSyncInterval('s1', 3600);
		const [url, init] = f.mock.calls[0];
		expect(new URL(url, 'http://x').pathname).toBe('/api/sync_services/s1');
		expect(init?.method).toBe('PUT');
		expect(JSON.parse(String(init?.body))).toEqual({ sync_interval_secs: 3600 });
	});

	it('clears the cadence with a PUT carrying null', async () => {
		const f = respond({ id: 's1', sync_interval_secs: null });
		await setSyncInterval('s1', null);
		const [, init] = f.mock.calls[0];
		expect(init?.method).toBe('PUT');
		expect(JSON.parse(String(init?.body))).toEqual({ sync_interval_secs: null });
	});

	it('switches the weekly full re-assert with a PUT on the sync_services row', async () => {
		const f = respond({ id: 's1', full_reassert_enabled: false });
		await setFullReassert('s1', false);
		const [url, init] = f.mock.calls[0];
		expect(new URL(url, 'http://x').pathname).toBe('/api/sync_services/s1');
		expect(init?.method).toBe('PUT');
		expect(JSON.parse(String(init?.body))).toEqual({ full_reassert_enabled: false });
	});
});
