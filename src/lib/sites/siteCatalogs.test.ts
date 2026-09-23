import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = { id: string; site_id?: string };
type ListOpts = { page?: number; perPage?: number; filter?: Record<string, unknown> };

function pagedClient(rows: Row[]) {
	const calls: ListOpts[] = [];
	return {
		calls,
		list: async (opts: ListOpts = {}) => {
			calls.push(opts);
			const site = opts.filter?.site_id;
			const matching = site ? rows.filter((r) => r.site_id === site) : rows;
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

const { siteSlots, siteDeployments, allThresholds } = await import('./siteCatalogs');

describe('site catalogs', () => {
	beforeEach(() => {
		clients.siteParameters = pagedClient([...rowsAt('site-1', 612), ...rowsAt('site-2', 40)]);
		clients.sensorDeployments = pagedClient([...rowsAt('site-1', 230), ...rowsAt('site-2', 3)]);
		clients.alarmThresholds = pagedClient(rowsAt('any', 1510));
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
});
