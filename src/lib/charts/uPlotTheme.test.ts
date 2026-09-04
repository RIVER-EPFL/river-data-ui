import { describe, expect, it } from 'vitest';
import type uPlot from 'uplot';
import { X_RANGE_PAD_FRACTION, xRangeWithPadding } from './uPlotTheme';

// Enough of a uPlot instance for the range function: the plot width decides how much time one
// marker glyph covers.
const plot = (width: number) => ({ width, pxRatio: 1 }) as unknown as uPlot;

describe('xRangeWithPadding', () => {
	it('pads both ends by a fraction of the span, so an endpoint marker is drawn whole', () => {
		const [min, max] = xRangeWithPadding(plot(1000), 0, 1000);
		expect(min).toBe(-1000 * X_RANGE_PAD_FRACTION);
		expect(max).toBe(1000 + 1000 * X_RANGE_PAD_FRACTION);
	});

	it('never pads by less than the widest glyph, however narrow the plot', () => {
		// 8px of glyph on a 100px plot is 8% of the span, more than the 2.5% fraction.
		const [min, max] = xRangeWithPadding(plot(100), 0, 1000);
		expect(min).toBe(-80);
		expect(max).toBe(1080);
	});

	it('gives a single instant a span to sit in', () => {
		expect(xRangeWithPadding(plot(1000), 500, 500)).toEqual([499, 501]);
	});

	it('leaves a range it cannot pad alone', () => {
		expect(xRangeWithPadding(plot(1000), NaN, 10)).toEqual([NaN, 10]);
	});
});
