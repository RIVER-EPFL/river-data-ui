import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$auth/keycloak.svelte', () => ({
	auth: { token: 'tok', ensureToken: async () => {} },
}));

const { api } = await import('./crud');

function respond(body: unknown, headers: Record<string, string> = {}) {
	const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
		ok: true,
		status: 200,
		statusText: 'ok',
		headers: new Headers(headers),
		json: async () => body,
		text: async () => JSON.stringify(body),
	}));
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

beforeEach(() => vi.unstubAllGlobals());

describe('notificationSubscribers', () => {
	it('reads the roster from the entity list, sorted by login', async () => {
		const f = respond([], { 'content-range': 'items 0-0/1' });
		await api.notificationSubscribers.list({ perPage: 500, sort: ['keycloak_sub', 'ASC'] });
		const url = new URL(f.mock.calls[0][0], 'http://x');
		expect(url.pathname).toBe('/api/notification_subscribers');
		expect(url.searchParams.get('sort')).toBe('["keycloak_sub","ASC"]');
		expect(url.searchParams.get('range')).toBe('[0,499]');
	});

	it('carries the device count the entity hook fills', async () => {
		respond(
			[
				{
					id: 'a',
					keycloak_sub: 'sub-1',
					web_push_enabled: true,
					push_subscription_count: 2,
					created_at: '2026-09-14T00:00:00Z',
					updated_at: '2026-09-14T00:00:00Z',
				},
			],
			{ 'content-range': 'items 0-0/1' },
		);
		const { data } = await api.notificationSubscribers.list();
		expect(data[0].push_subscription_count).toBe(2);
	});
});
