import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScatterSpec } from '$lib/explore/chartSpecs';

const GET = vi.fn();
vi.mock('$api/client', () => ({ GET: (...args: unknown[]) => GET(...args) }));
vi.mock('$components/charts/ScatterPlot.svelte', async () => ({
	default: (await import('../../../tests/stubs/ScatterPlotStub.svelte')).default,
}));

const ScatterTab = (await import('./ScatterTab.svelte')).default;

const sites = [{ id: 'site-a', name: 'Martigny' }, { id: 'site-b', name: 'Saxon' }];
const params = [
	{ id: 'p1', name: 'Depth', default_units: 'mm' },
	{ id: 'p2', name: 'Turbidity', default_units: 'NTU' },
	{ id: 'p3', name: 'CDOM', default_units: 'ppb' },
];
const siteParams = [
	{ id: 'sp1', site_id: 'site-a', parameter_id: 'p1', display_units: null },
	{ id: 'sp2', site_id: 'site-a', parameter_id: 'p2', display_units: null },
	{ id: 'sp3', site_id: 'site-a', parameter_id: 'p3', display_units: null },
];

const START = 1_700_000_000_000;
const END = START + 86_400_000;

function spec(xParamId: string, yParamId: string): ScatterSpec {
	return { siteId: 'site-a', xParamId, yParamId, start: START, end: END };
}

function readings(ids: string[]) {
	return {
		times: ['2023-11-14T22:13:20Z', '2023-11-14T23:13:20Z'],
		parameters: ids.map((id) => ({ id: `sp-${id}`, parameter_id: id, values: [1, 2] })),
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	GET.mockImplementation(async (path: string, query?: Record<string, string>) => {
		if (path.endsWith('/detail')) return { data_start: null, data_end: null };
		return readings(String(query?.parameter_ids ?? '').split(','));
	});
});

function plots(): string[] {
	return screen.queryAllByTestId('scatter-plot').map((p) => p.textContent ?? '');
}

function open(specs: ScatterSpec[]) {
	return render(ScatterTab, { sites, params, siteParams, specs } as never);
}

describe('ScatterTab', () => {
	it('renders one scatter plot per spec', async () => {
		open([spec('p1', 'p2'), spec('p2', 'p3')]);
		await waitFor(() => expect(plots()).toEqual(['Depth vs Turbidity', 'Turbidity vs CDOM']));
	});

	it('adds a chart seeded from the last one and removes a chart by its own control', async () => {
		open([spec('p1', 'p2')]);
		await waitFor(() => expect(plots()).toHaveLength(1));
		await fireEvent.click(screen.getByRole('button', { name: 'Add chart' }));
		await waitFor(() => expect(plots()).toEqual(['Depth vs Turbidity', 'Depth vs Turbidity']));
		const removes = screen.getAllByRole('button', { name: 'Remove chart' });
		expect(removes).toHaveLength(2);
		await fireEvent.click(removes[0]);
		await waitFor(() => expect(plots()).toHaveLength(1));
	});

	it('keeps the last chart, so a layout is never empty', async () => {
		open([spec('p1', 'p2')]);
		await screen.findAllByTestId('scatter-plot');
		const remove = screen.getByRole('button', { name: 'Remove chart' }) as HTMLButtonElement;
		expect(remove.disabled).toBe(true);
	});
});
