import { describe, expect, it } from 'vitest';

import type { SpotPointStats } from './spotMarkers';
import { cursorPoints, stepCursor } from './keyboardCursor';

const continuous = { times: [1000, 2000, 3000, 4000], values: [1, null, 3, 4] };
const spot = { times: [2500, 500], values: [20, 5] };

describe('cursorPoints', () => {
	it('merges spot and continuous points in time order and skips gaps', () => {
		const points = cursorPoints(continuous, spot, null, true);
		expect(points.map((p) => [p.timeMs, p.value, p.measurementType])).toEqual([
			[500, 5, 'spot'],
			[1000, 1, 'continuous'],
			[2500, 20, 'spot'],
			[3000, 3, 'continuous'],
			[4000, 4, 'continuous'],
		]);
	});

	it('leaves aggregate buckets out, since no reading sits at a bucket start', () => {
		const points = cursorPoints(continuous, spot, null, false);
		expect(points.map((p) => p.measurementType)).toEqual(['spot', 'spot']);
	});

	it('lands a spot point on its served mean and carries its sample', () => {
		const stats = new Map<number, SpotPointStats>([[2500, { mean: 21.5, stdev: 0.3, n: 3, sampleId: 'smp' }]]);
		const [, spotPoint] = cursorPoints(null, spot, stats, true);
		expect(spotPoint.value).toBe(21.5);
		expect(spotPoint.sampleId).toBe('smp');
	});
});

describe('stepCursor', () => {
	it('enters from either end and stops at the bounds', () => {
		expect(stepCursor(null, 'ArrowRight', 5)).toBe(0);
		expect(stepCursor(null, 'ArrowLeft', 5)).toBe(4);
		expect(stepCursor(4, 'ArrowRight', 5)).toBe(4);
		expect(stepCursor(0, 'ArrowLeft', 5)).toBe(0);
		expect(stepCursor(2, 'ArrowRight', 5)).toBe(3);
	});

	it('jumps by a tenth of the series and to the ends', () => {
		expect(stepCursor(0, 'PageDown', 100)).toBe(10);
		expect(stepCursor(95, 'PageDown', 100)).toBe(99);
		expect(stepCursor(50, 'PageUp', 100)).toBe(40);
		expect(stepCursor(3, 'PageUp', 5)).toBe(2);
		expect(stepCursor(2, 'Home', 5)).toBe(0);
		expect(stepCursor(2, 'End', 5)).toBe(4);
	});

	it('ignores other keys and an empty series', () => {
		expect(stepCursor(2, 'a', 5)).toBeNull();
		expect(stepCursor(null, 'ArrowRight', 0)).toBeNull();
	});
});
