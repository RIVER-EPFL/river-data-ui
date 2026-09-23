import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const previewDerived = vi.fn();
const getSiteDetail = vi.fn();
vi.mock('$api/service', () => ({
	getSiteDetail: (id: string) => getSiteDetail(id),
	previewDerived: (p: unknown) => previewDerived(p)
}));
vi.mock('$lib/components/charts/UPlotChart.svelte', async () => ({
	default: (await import('./PreviewChartStub.test.svelte')).default
}));

import LivePreview from './LivePreview.svelte';

const props = {
	formulas: [
		{ code: 'step', formula: 'a + 1', ordinal: 0, intermediate: true },
		{ code: 'out', formula: 'step * 2', ordinal: 1, intermediate: false }
	],
	siteId: 'site-1',
	sites: [{ id: 'site-1', name: 'Martigny' }],
	reads: ['a']
};

describe('LivePreview', () => {
	beforeEach(() => {
		previewDerived.mockReset();
		previewDerived.mockResolvedValue({ times: [], source_parameters: [], formulas: [] });
		getSiteDetail.mockReset();
		getSiteDetail.mockResolvedValue({
			parameters: [
				{ code: 'a', data_start: '2023-04-01T00:00:00Z', data_end: '2024-09-01T00:00:00Z' },
				{ code: 'b', data_start: '2019-01-01T00:00:00Z', data_end: '2026-09-01T00:00:00Z' }
			]
		});
		vi.useFakeTimers();
	});

	it('sends the whole set, steps included', async () => {
		render(LivePreview, props);
		await vi.advanceTimersByTimeAsync(500);
		const sent = previewDerived.mock.calls[0][0] as { formulas: Array<{ code: string }> };
		expect(sent.formulas.map((f) => f.code)).toEqual(['step', 'out']);
	});

	it('posts nothing while the only row is blank, and says so', async () => {
		render(LivePreview, {
			...props,
			formulas: [{ code: '', formula: '', ordinal: 0, intermediate: false }]
		});
		await vi.advanceTimersByTimeAsync(500);
		expect(previewDerived).not.toHaveBeenCalled();
		expect(screen.getByText(/Nothing to preview yet/)).toBeTruthy();
	});

	it('draws nothing until a site is chosen', async () => {
		render(LivePreview, { ...props, siteId: '' });
		await vi.advanceTimersByTimeAsync(500);
		expect(previewDerived).not.toHaveBeenCalled();
		expect(screen.getByText(/Choose a site above/)).toBeTruthy();
	});

	it('opens on the whole span the read parameters cover at the site', async () => {
		render(LivePreview, props);
		await vi.advanceTimersByTimeAsync(500);
		expect(previewDerived).toHaveBeenCalledTimes(1);
		const sent = previewDerived.mock.calls[0][0] as { start: string; end: string };
		expect(sent.start).toBe('2023-04-01T00:00:00.000Z');
		expect(sent.end).toBe('2024-09-01T00:00:00.000Z');
	});

	it('refetches when the range changes, ending where the data ends', async () => {
		render(LivePreview, props);
		await vi.advanceTimersByTimeAsync(500);
		expect(previewDerived).toHaveBeenCalledTimes(1);

		await fireEvent.click(screen.getByText('30d'));
		await vi.advanceTimersByTimeAsync(500);
		expect(previewDerived).toHaveBeenCalledTimes(2);
		const second = previewDerived.mock.calls[1][0] as { start: string; end: string };
		expect(second.start).toBe('2024-08-02T00:00:00.000Z');
		expect(second.end).toBe('2024-09-01T00:00:00.000Z');
	});
});
