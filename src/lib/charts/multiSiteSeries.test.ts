import { beforeEach, describe, expect, it, vi } from 'vitest';
import { autoResolution, fetchSiteSeries, mergeSeries } from './multiSiteSeries';
import { GET } from '$api/client';

vi.mock('$api/client', () => ({ GET: vi.fn() }));

describe('mergeSeries', () => {
	it('unions timestamps and pads each series with null where it has no point', () => {
		const [xs, a, b] = mergeSeries([
			{ times: [1000, 3000], values: [1, 3] },
			{ times: [2000, 3000], values: [20, 30] },
		]) as [number[], (number | null)[], (number | null)[]];
		expect(xs).toEqual([1, 2, 3]);
		expect(a).toEqual([1, null, 3]);
		expect(b).toEqual([null, 20, 30]);
	});

	it('sorts the union, so out-of-order inputs still align', () => {
		const [xs] = mergeSeries([{ times: [5000, 1000], values: [5, 1] }]) as [number[]];
		expect(xs).toEqual([1, 5]);
	});

	it('returns a single empty x series for no input', () => {
		expect(mergeSeries([])).toEqual([[]]);
	});
});

describe('autoResolution', () => {
	const day = 86400000;
	it('holds raw up to fourteen days and switches at the boundaries', () => {
		expect(autoResolution(0, 14 * day)).toBe('raw');
		expect(autoResolution(0, 15 * day)).toBe('hourly');
		expect(autoResolution(0, 120 * day)).toBe('hourly');
		expect(autoResolution(0, 121 * day)).toBe('daily');
	});
});

describe('fetchSiteSeries', () => {
	beforeEach(() => {
		vi.mocked(GET).mockReset();
		vi.mocked(GET).mockResolvedValue({ times: [], parameters: [] });
	});

	async function fetchSpot(includeSampleStats: boolean) {
		await fetchSiteSeries({
			siteId: 'site-1',
			parameterId: 'param-1',
			start: '2025-01-01T00:00:00Z',
			end: '2025-02-01T00:00:00Z',
			resolution: 'raw',
			measurementType: 'spot',
			includeSampleStats,
		});
		return vi.mocked(GET).mock.calls[0][1] as Record<string, string>;
	}

	it('asks for the replicate statistics and the curves in the drawing request', async () => {
		const query = await fetchSpot(true);
		expect(query.include_sample_stats).toBe('true');
		expect(query.include_curves).toBe('true');
	});

	it('asks for neither when the caller does not want them', async () => {
		const query = await fetchSpot(false);
		expect(query.include_sample_stats).toBeUndefined();
		expect(query.include_curves).toBeUndefined();
	});

	it('carries n, sd, range and curve references onto each spot point', async () => {
		vi.mocked(GET).mockResolvedValue({
			times: ['2025-01-05T10:00:00Z'],
			parameters: [
				{
					id: 'sp-1',
					parameter_id: 'param-1',
					name: 'DOC',
					units: 'ppb',
					values: [48.2],
					samples: [
						{ sample_id: 's1', n: 3, mean: 48.2, stdev: 11.6, min: 41.2, max: 62, replicates: [] },
					],
					calibration_ids: ['cal-1'],
					standard_curve_ids: [null],
				},
			],
		});
		const series = await fetchSiteSeries({
			siteId: 'site-1',
			parameterId: 'param-1',
			start: '2025-01-01T00:00:00Z',
			end: '2025-02-01T00:00:00Z',
			resolution: 'raw',
			measurementType: 'spot',
			includeSampleStats: true,
		});
		const stat = series.stats?.get(new Date('2025-01-05T10:00:00Z').getTime());
		expect(stat).toMatchObject({
			n: 3,
			stdev: 11.6,
			min: 41.2,
			max: 62,
			calibrationId: 'cal-1',
			standardCurveId: null,
		});
	});
});
