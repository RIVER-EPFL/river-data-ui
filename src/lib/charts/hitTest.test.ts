import { describe, expect, it } from 'vitest';

import { continuousPointAt, type Scale } from './hitTest';

// The x scale is the chart's own: seconds, one pixel per second, with the series starting at the
// left edge. The y scale is one pixel per unit.
const START_SEC = 1_788_942_000;
const scale: Scale = {
	posToVal: (pos) => START_SEC + pos,
	valToPos: (val, axis) => (axis === 'x' ? val - START_SEC : val),
};

const times = [START_SEC, START_SEC + 100, START_SEC + 200, START_SEC + 300];
const values = [10, 20, null, 40];
const tolerance = { x: 8, y: 12 };

describe('continuousPointAt', () => {
	it('answers a click on a reading with that reading instant, in milliseconds', () => {
		const hit = continuousPointAt(scale, 100, 20, times, values, tolerance);
		expect(hit?.timeMs).toBe((START_SEC + 100) * 1000);
	});

	it('takes the nearer of two readings within the tolerance', () => {
		const near = continuousPointAt(scale, 104, 40, [START_SEC, START_SEC + 100], [10, 20], {
			x: 200,
			y: 200,
		});
		expect(near?.timeMs).toBe((START_SEC + 100) * 1000);
	});

	it('answers nothing away from the line, so a click on empty plot area is not a point', () => {
		expect(continuousPointAt(scale, 100, 200, times, values, tolerance)).toBeNull();
		expect(continuousPointAt(scale, 150, 20, times, values, tolerance)).toBeNull();
	});

	it('skips a gap rather than reporting the reading that is not there', () => {
		expect(continuousPointAt(scale, 200, 0, times, values, tolerance)).toBeNull();
	});

	it('answers nothing on an empty series', () => {
		expect(continuousPointAt(scale, 100, 20, [], [], tolerance)).toBeNull();
	});
});
