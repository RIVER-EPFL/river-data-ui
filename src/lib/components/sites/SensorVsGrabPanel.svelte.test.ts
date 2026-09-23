import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const download = vi.fn();
vi.mock('$api/client', () => ({
	ApiError: class extends Error {},
	GET: vi.fn(),
	POST: vi.fn(),
	PATCH: vi.fn(),
	PUT: vi.fn(),
	DELETE: vi.fn(),
	getList: vi.fn(),
	download: (path: string, filename: string) => download(path, filename),
}));

const SensorVsGrabPanel = (await import('./SensorVsGrabPanel.svelte')).default;

beforeEach(() => download.mockReset().mockResolvedValue(undefined));

describe('SensorVsGrabPanel', () => {
	it('downloads the csv through the authenticated client', async () => {
		render(SensorVsGrabPanel, {
			siteId: 's1',
			parameters: [{ id: 'p1', label: 'DOC (mg/L)' }],
		});
		await userEvent.selectOptions(screen.getByLabelText('Parameter'), 'p1');
		await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }));

		expect(download).toHaveBeenCalledTimes(1);
		const [path, filename] = download.mock.calls[0];
		const url = new URL(path, 'http://x');
		expect(url.pathname).toBe('/api/sites/s1/export/sensor-vs-grab');
		expect(url.searchParams.get('parameter_id')).toBe('p1');
		expect(url.searchParams.get('window_start_hours')).toBe('2');
		expect(url.searchParams.get('window_end_hours')).toBe('6');
		expect(url.searchParams.get('format')).toBe('csv');
		expect(filename).toBe('DOC__mg_L__sensor_vs_grab.csv');
	});

	it('offers no download before a parameter is chosen', () => {
		render(SensorVsGrabPanel, { siteId: 's1', parameters: [{ id: 'p1', label: 'DOC' }] });
		expect(screen.queryByRole('button', { name: 'Download CSV' })).toBeNull();
		expect(screen.queryByRole('link', { name: 'Download CSV' })).toBeNull();
	});
});
