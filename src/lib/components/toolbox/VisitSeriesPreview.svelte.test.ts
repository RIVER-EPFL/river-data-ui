import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const draftRunFormulasAtVisits = vi.fn();
vi.mock('$api/service', () => ({
	draftRunFormulasAtVisits: (id: string, body: unknown) => draftRunFormulasAtVisits(id, body),
}));
vi.mock('$lib/components/charts/UPlotChart.svelte', async () => ({
	default: (await import('../derived/PreviewChartStub.test.svelte')).default,
}));

import VisitSeriesPreview from './VisitSeriesPreview.svelte';

const formula = (code: string, text: string, per_replicate = '') => ({
	id: null,
	code,
	name: '',
	units: '',
	formula: text,
	ordinal: 0,
	per_replicate,
	curve_slot: '',
	intermediate: false,
});
const visit = (id: string, collected_at: string) => ({ id, collected_at }) as never;
const ran = (value: number[]) => ({
	ran: true,
	results: { CO2: value },
	event_inputs: [{ param: 'ppm', value }],
	failure: null,
});

describe('VisitSeriesPreview', () => {
	beforeEach(() => {
		draftRunFormulasAtVisits.mockReset();
		vi.useFakeTimers();
	});

	it('runs the set at every visit in one request, oldest first, and draws it', async () => {
		draftRunFormulasAtVisits.mockResolvedValue({
			runs: [ran([1, 2]), ran([3, 4])],
			manifest: { outputs: [] },
		});
		render(VisitSeriesPreview, {
			calculationId: 'calc-1',
			formulas: [formula('CO2', 'ppm * 2', 'ppm')] as never,
			siteId: 'site-1',
			visits: [visit('b', '2021-09-09T13:30:00Z'), visit('a', '2021-06-01T10:00:00Z')],
		});
		await vi.advanceTimersByTimeAsync(500);
		expect(draftRunFormulasAtVisits).toHaveBeenCalledTimes(1);
		const [id, body] = draftRunFormulasAtVisits.mock.calls[0] as [
			string,
			{ inputs: Array<{ collected_at: string; site_id: string }> },
		];
		expect(id).toBe('calc-1');
		expect(body.inputs.map((i) => i.collected_at)).toEqual([
			'2021-06-01T10:00:00Z',
			'2021-09-09T13:30:00Z',
		]);
		expect(body.inputs.every((i) => i.site_id === 'site-1')).toBe(true);
		expect(screen.getByText('2 visits')).toBeTruthy();
		expect(screen.getByTestId('chart')).toBeTruthy();
	});

	it('says so when no visit holds the inputs, and asks nothing', async () => {
		render(VisitSeriesPreview, {
			calculationId: 'calc-1',
			formulas: [formula('CO2', 'ppm * 2')] as never,
			siteId: 'site-1',
			visits: [],
		});
		await vi.advanceTimersByTimeAsync(500);
		expect(draftRunFormulasAtVisits).not.toHaveBeenCalled();
		expect(screen.getByText(/No visit at this site holds/)).toBeTruthy();
	});

	it('asks nothing while the formula being typed does not parse, and keeps what it drew', async () => {
		draftRunFormulasAtVisits.mockResolvedValue({ runs: [ran([1, 2])], manifest: { outputs: [] } });
		const props = {
			calculationId: 'calc-1',
			formulas: [formula('CO2', 'ppm * 2', 'ppm')] as never,
			siteId: 'site-1',
			visits: [visit('a', '2021-06-01T10:00:00Z')],
			paused: false,
		};
		const view = render(VisitSeriesPreview, props);
		await vi.advanceTimersByTimeAsync(500);
		expect(draftRunFormulasAtVisits).toHaveBeenCalledTimes(1);
		await view.rerender({ ...props, formulas: [formula('CO2', 'ppm *', 'ppm')] as never, paused: true });
		await vi.advanceTimersByTimeAsync(500);
		expect(draftRunFormulasAtVisits).toHaveBeenCalledTimes(1);
		expect(screen.getByTestId('chart')).toBeTruthy();
	});

	it('shows a refusal as its message rather than the response body', async () => {
		draftRunFormulasAtVisits.mockRejectedValue(new Error('{"error":"CO2: unknown variable ppn"}'));
		render(VisitSeriesPreview, {
			calculationId: 'calc-1',
			formulas: [formula('CO2', 'ppn * 2')] as never,
			siteId: 'site-1',
			visits: [visit('a', '2021-06-01T10:00:00Z')],
		});
		await vi.advanceTimersByTimeAsync(500);
		expect(screen.getByText('Not drawn: CO2: unknown variable ppn')).toBeTruthy();
	});
});
