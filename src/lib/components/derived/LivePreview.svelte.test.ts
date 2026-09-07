import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const previewDerived = vi.fn();
vi.mock('$api/service', () => ({ previewDerived: (p: unknown) => previewDerived(p) }));
vi.mock('$lib/components/charts/UPlotChart.svelte', async () => ({
	default: (await import('./PreviewChartStub.test.svelte')).default
}));

import LivePreview from './LivePreview.svelte';

const props = {
	formula: 'a * 2',
	sites: [{ id: 'site-1', name: 'Martigny' }],
	variableNames: ['a']
};

describe('LivePreview', () => {
	beforeEach(() => {
		previewDerived.mockReset();
		previewDerived.mockResolvedValue({ times: [], values: [], param_info: [] });
		vi.useFakeTimers();
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
