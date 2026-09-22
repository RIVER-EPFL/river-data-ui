import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const previewDerived = vi.fn();
vi.mock('$api/service', () => ({ previewDerived: (p: unknown) => previewDerived(p) }));
vi.mock('$lib/components/charts/UPlotChart.svelte', async () => ({
	default: (await import('./PreviewChartStub.test.svelte')).default
}));

import LivePreview from './LivePreview.svelte';

const props = {
	formulas: [
		{ code: 'step', formula: 'a + 1', ordinal: 0, intermediate: true },
		{ code: 'out', formula: 'step * 2', ordinal: 1, intermediate: false }
	],
	sites: [{ id: 'site-1', name: 'Martigny' }],
	variableNames: ['a']
};

describe('LivePreview', () => {
	beforeEach(() => {
		previewDerived.mockReset();
		previewDerived.mockResolvedValue({ times: [], source_parameters: [], formulas: [] });
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

	it('refetches when the range changes', async () => {
		render(LivePreview, props);
		await vi.advanceTimersByTimeAsync(500);
		expect(previewDerived).toHaveBeenCalledTimes(1);
		const first = previewDerived.mock.calls[0][0] as { start: string; end: string };

		await fireEvent.click(screen.getByText('30d'));
		await vi.advanceTimersByTimeAsync(500);
		expect(previewDerived).toHaveBeenCalledTimes(2);
		const second = previewDerived.mock.calls[1][0] as { start: string; end: string };
		expect(Date.parse(second.start)).toBeLessThan(Date.parse(first.start));
	});
});
