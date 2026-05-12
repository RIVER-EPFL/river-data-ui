import { auth } from '$auth/keycloak.svelte';

export class ApiError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
	}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	await auth.ensureToken();

	const headers = new Headers(init?.headers);
	if (!headers.has('Content-Type') && init?.body) {
		headers.set('Content-Type', 'application/json');
	}
	if (auth.token) {
		headers.set('Authorization', `Bearer ${auth.token}`);
	}

	const res = await fetch(path, { ...init, headers });
	if (!res.ok) {
		const text = await res.text().catch(() => res.statusText);
		throw new ApiError(res.status, text);
	}

	if (res.status === 204) return undefined as T;
	return res.json();
}

export function GET<T>(path: string, params?: Record<string, unknown>): Promise<T> {
	const url = params ? `${path}?${searchParams(params)}` : path;
	return request<T>(url);
}

export function POST<T>(path: string, body?: unknown): Promise<T> {
	return request<T>(path, {
		method: 'POST',
		body: body != null ? JSON.stringify(body) : undefined,
	});
}

export function PATCH<T>(path: string, body?: unknown): Promise<T> {
	return request<T>(path, {
		method: 'PATCH',
		body: body != null ? JSON.stringify(body) : undefined,
	});
}

export function PUT<T>(path: string, body?: unknown): Promise<T> {
	return request<T>(path, {
		method: 'PUT',
		body: body != null ? JSON.stringify(body) : undefined,
	});
}

export function DELETE<T>(path: string): Promise<T> {
	return request<T>(path, {
		method: 'DELETE',
		headers: { 'Content-Type': 'text/plain' },
	});
}

export interface Paginated<T> {
	data: T[];
	total: number;
}

export async function getList<T>(
	path: string,
	opts: {
		page?: number;
		perPage?: number;
		sort?: [string, 'ASC' | 'DESC'];
		filter?: Record<string, unknown>;
	} = {},
): Promise<Paginated<T>> {
	await auth.ensureToken();

	const page = opts.page ?? 1;
	const perPage = opts.perPage ?? 25;
	const rangeStart = (page - 1) * perPage;
	const rangeEnd = page * perPage - 1;

	const query = new URLSearchParams();
	if (opts.sort) query.set('sort', JSON.stringify(opts.sort));
	query.set('range', JSON.stringify([rangeStart, rangeEnd]));
	if (opts.filter) query.set('filter', JSON.stringify(opts.filter));

	const headers = new Headers();
	headers.set('Range', `items=${rangeStart}-${rangeEnd}`);
	if (auth.token) headers.set('Authorization', `Bearer ${auth.token}`);

	const res = await fetch(`${path}?${query}`, { headers });
	if (!res.ok) {
		const text = await res.text().catch(() => res.statusText);
		throw new ApiError(res.status, text);
	}

	const data: T[] = await res.json();
	const contentRange = res.headers.get('content-range') ?? '';
	const total = parseInt(contentRange.split('/').pop() ?? '0', 10);

	return { data, total: isNaN(total) ? 0 : total };
}

function searchParams(params: Record<string, unknown>): string {
	const sp = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v != null) sp.set(k, String(v));
	}
	return sp.toString();
}
