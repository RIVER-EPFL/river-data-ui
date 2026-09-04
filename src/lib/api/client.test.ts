import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$auth/keycloak.svelte', () => ({
	auth: { token: 'tok', ensureToken: async () => {} },
}));

const { GET, POST, getList, ApiError } = await import('./client');

function respond(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
	const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
		ok: (init.status ?? 200) < 400,
		status: init.status ?? 200,
		statusText: 'err',
		headers: new Headers(init.headers ?? {}),
		json: async () => body,
		text: async () => String(body),
	}));
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

beforeEach(() => vi.unstubAllGlobals());

describe('GET', () => {
	it('drops null and undefined params and stringifies the rest', async () => {
		const f = respond({});
		await GET('/api/sites', { start: '2026-01-01', page: 2, end: null, format: undefined });
		const url = new URL(f.mock.calls[0][0], 'http://x');
		expect(url.searchParams.get('start')).toBe('2026-01-01');
		expect(url.searchParams.get('page')).toBe('2');
		expect(url.searchParams.has('end')).toBe(false);
		expect(url.searchParams.has('format')).toBe(false);
	});

	it('sends the bearer token and no body content type', async () => {
		const f = respond({});
		await GET('/api/sites');
		const headers = (f.mock.calls[0][1] as unknown as { headers: Headers }).headers;
		expect(headers.get('Authorization')).toBe('Bearer tok');
		expect(headers.has('Content-Type')).toBe(false);
	});

	it('throws ApiError carrying the status', async () => {
		respond('nope', { status: 403 });
		await expect(GET('/api/sites')).rejects.toBeInstanceOf(ApiError);
	});
});

describe('POST', () => {
	it('sets the json content type when there is a body', async () => {
		const f = respond({});
		await POST('/api/sites', { name: 'FP1' });
		const init = f.mock.calls[0][1] as unknown as { headers: Headers; body: string };
		expect(init.headers.get('Content-Type')).toBe('application/json');
		expect(init.body).toBe('{"name":"FP1"}');
	});
});

describe('getList', () => {
	it('translates page and per-page into a zero-based inclusive range', async () => {
		const f = respond([], { headers: { 'content-range': 'items 25-49/312' } });
		const result = await getList('/api/sites', { page: 2, perPage: 25 });
		const url = new URL(f.mock.calls[0][0], 'http://x');
		expect(url.searchParams.get('range')).toBe('[25,49]');
		expect((f.mock.calls[0][1] as unknown as { headers: Headers }).headers.get('Range')).toBe('items=25-49');
		expect(result.total).toBe(312);
	});

	it('reports a zero total when the server sends no content-range', async () => {
		respond([]);
		expect((await getList('/api/sites')).total).toBe(0);
	});
});
