import type { CrudClient } from './crud';

// A single `list` call is bounded by its page size, so any client-side match over "the whole
// catalog" silently stops at that boundary once the table outgrows it. `listAll` follows the
// Content-Range total instead of assuming one page covers everything.

/** Pages a CRUD list to completion. `cap` bounds a runaway loop rather than the data. */
export async function listAll<T>(
	client: CrudClient<T>,
	opts: {
		perPage?: number;
		sort?: [string, 'ASC' | 'DESC'];
		filter?: Record<string, unknown>;
	} = {},
	cap = 20000,
): Promise<T[]> {
	const perPage = opts.perPage ?? 500;
	const collected: T[] = [];
	let page = 1;
	for (;;) {
		const res = await client.list({ ...opts, page, perPage });
		collected.push(...res.data);
		if (res.data.length < perPage || collected.length >= res.total || collected.length >= cap) {
			return collected;
		}
		page += 1;
	}
}
