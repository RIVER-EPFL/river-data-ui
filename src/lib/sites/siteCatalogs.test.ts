import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = { id: string; site_id?: string; group_id?: string };
type ListOpts = {
	page?: number;
	perPage?: number;
	sort?: [string, 'ASC' | 'DESC'];
	filter?: Record<string, unknown>;
};

function pagedClient(rows: Row[]) {
	const calls: ListOpts[] = [];
	return {
		calls,
		list: async (opts: ListOpts = {}) => {
			calls.push(opts);
			const filter = Object.entries(opts.filter ?? {});
			const matching = rows.filter((r) => filter.every(([k, v]) => r[k as keyof Row] === v));
			const perPage = opts.perPage ?? 25;
			const start = ((opts.page ?? 1) - 1) * perPage;
			return { data: matching.slice(start, start + perPage), total: matching.length };
		},
	};
}

function rowsAt(site: string, n: number): Row[] {
	return Array.from({ length: n }, (_, i) => ({ id: `${site}-${i}`, site_id: site }));
}

const clients = vi.hoisted(() => ({}) as Record<string, ReturnType<typeof pagedClient>>);

vi.mock('$api/crud', () => ({
	api: new Proxy({}, { get: (_t, key: string) => clients[key] }),
}));

const { siteSlots, siteDeployments, allThresholds, allParameterGroups, parameterGroupMembers } = await import(
	'./siteCatalogs'
);

describe('site catalogs', () => {
	beforeEach(() => {
		clients.siteParameters = pagedClient([...rowsAt('site-1', 612), ...rowsAt('site-2', 40)]);
		clients.sensorDeployments = pagedClient([...rowsAt('site-1', 230), ...rowsAt('site-2', 3)]);
		clients.alarmThresholds = pagedClient(rowsAt('any', 1510));
		clients.parameterGroups = pagedClient(rowsAt('any', 730));
		clients.parameterGroupMembers = pagedClient([
			...Array.from({ length: 1240 }, (_, i) => ({ id: `m-${i}`, group_id: 'group-1' })),
			...Array.from({ length: 30 }, (_, i) => ({ id: `n-${i}`, group_id: 'group-2' })),
		]);
	});

	it('reads every slot of the site past the first page', async () => {
		const slots = await siteSlots('site-1');
		// 612 slots at site-1, none of site-2's 40
		expect(slots).toHaveLength(612);
		expect(slots.every((s) => s.site_id === 'site-1')).toBe(true);
		expect(clients.siteParameters.calls.length).toBeGreaterThan(1);
	});

	it('reads every deployment of the site past the first page', async () => {
		const deps = await siteDeployments('site-1');
		expect(deps).toHaveLength(230);
		expect(deps.every((d) => d.site_id === 'site-1')).toBe(true);
	});

	it('reads every threshold row, not the first 200', async () => {
		expect(await allThresholds()).toHaveLength(1510);
	});

	it('reads every parameter group in ordinal order, not the first 200', async () => {
		expect(await allParameterGroups()).toHaveLength(730);
		expect(clients.parameterGroups.calls.every((c) => c.sort?.[0] === 'ordinal' && c.sort?.[1] === 'ASC')).toBe(true);
	});

	it('reads every member of every group, not the first 1000', async () => {
		// 1240 in group-1 plus 30 in group-2
		expect(await parameterGroupMembers()).toHaveLength(1270);
	});

	it('reads every member of one group, not the first 500', async () => {
		const members = await parameterGroupMembers('group-1');
		expect(members).toHaveLength(1240);
		expect(clients.parameterGroupMembers.calls.every((c) => c.filter?.group_id === 'group-1')).toBe(true);
	});
});
