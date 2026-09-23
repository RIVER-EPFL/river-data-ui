import { render, screen, waitFor } from '@testing-library/svelte';
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
vi.mock('$api/service', () => ({
	getSiteExportSummary: vi.fn().mockResolvedValue(null),
}));

const SiteExportDialog = (await import('./SiteExportDialog.svelte')).default;

const START = Date.parse('2025-06-01T00:00:00Z');
const END = Date.parse('2025-06-08T00:00:00Z');

beforeEach(() => download.mockReset().mockResolvedValue(undefined));

describe('SiteExportDialog', () => {
	it('downloads the readings through the authenticated client', async () => {
		render(SiteExportDialog, {
			open: true,
			siteId: 's1',
			siteName: 'FP15',
			siteParameters: [],
			rangeStartMs: START,
			rangeEndMs: END,
			sliderMinMs: START,
			sliderMaxMs: END,
			paramName: (id: string) => id,
			paramCode: (id: string) => id,
		});
		await userEvent.click(screen.getByRole('button', { name: 'Download' }));

		await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
		const [path, filename] = download.mock.calls[0];
		const url = new URL(path, 'http://x');
		expect(url.pathname).toBe('/api/sites/s1/aggregates/hourly');
		expect(url.searchParams.get('start')).toBe('2025-06-01T00:00:00.000Z');
		expect(url.searchParams.get('end')).toBe('2025-06-08T00:00:00.000Z');
		expect(filename).toBe('FP15_hourly.csv');
	});
});
