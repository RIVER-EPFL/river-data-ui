import { describe, expect, it } from 'vitest';
import { seriesColor, seriesKey, spotMarkerColors, swatchStyle, tooltipRow } from './legend';
import { tokens } from './tokens';

describe('seriesColor', () => {
	it('wraps at the palette length rather than resolving nothing', () => {
		expect(seriesColor(0)).toBe(tokens.dataViz[0]);
		expect(seriesColor(8)).toBe(tokens.dataViz[0]);
		expect(seriesColor(9)).toBe(tokens.dataViz[1]);
	});

	it('resolves to a colour for any index a site can produce', () => {
		for (let i = 0; i < 40; i++) expect(seriesColor(i)).toMatch(/^#[0-9A-F]{6}$/i);
	});
});

describe('seriesKey', () => {
	it('gives the first cycle a solid line', () => {
		expect(seriesKey(0).dash).toBeUndefined();
		expect(seriesKey(7).dash).toBeUndefined();
	});

	it('adds a dash pattern once the palette has been spent', () => {
		expect(seriesKey(8).dash).toBeDefined();
	});

	// A site page registers its measurement parameters and its device-health parameters into one
	// chart-sync group off one counter, so the pairs have to stay distinct well past eight.
	it('never repeats a colour and dash pair inside one group', () => {
		const seen = new Set<string>();
		for (let i = 0; i < 24; i++) {
			const k = seriesKey(i);
			const id = `${k.color}|${(k.dash ?? []).join(',')}`;
			expect(seen.has(id)).toBe(false);
			seen.add(id);
		}
	});
});

describe('spotMarkerColors', () => {
	it('derives the diamond from its own series, so cadence is the shape and not the hue', () => {
		expect(spotMarkerColors(1).stroke).toBe(seriesColor(1));
		expect(spotMarkerColors(0).fill).not.toBe(spotMarkerColors(1).fill);
	});

	it('fills more lightly than it strokes, so a dense run of diamonds stays readable', () => {
		expect(spotMarkerColors(0).fill).toMatch(/^rgba\(/);
	});
});

describe('swatchStyle', () => {
	it('paints the dash pattern it stands for, so the legend chip matches its line', () => {
		expect(swatchStyle(seriesKey(0))).not.toMatch(/gradient/);
		expect(swatchStyle(seriesKey(8))).toMatch(/gradient/);
	});

	it('outlines the chip', () => {
		expect(tooltipRow(seriesKey(0)).swatch).toMatch(/box-shadow/);
	});

	it('paints the tooltip row with the chip its legend draws', () => {
		expect(tooltipRow(seriesKey(8)).swatch).toBe(swatchStyle(seriesKey(8)));
	});
});
