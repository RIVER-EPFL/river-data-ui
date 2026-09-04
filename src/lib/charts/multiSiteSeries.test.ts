import { describe, expect, it } from 'vitest';
import { autoResolution, mergeSeries } from './multiSiteSeries';

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
