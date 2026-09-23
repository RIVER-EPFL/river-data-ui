import { describe, expect, it } from 'vitest';
import { composite, contrastRatio, parseColor, relativeLuminance } from './color';

describe('parseColor', () => {
	it('reads long and short hex and rgb forms', () => {
		expect(parseColor('#0072B2')).toEqual({ r: 0, g: 114, b: 178, a: 1 });
		expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
		expect(parseColor('rgba(202,138,4,0.16)')).toEqual({ r: 202, g: 138, b: 4, a: 0.16 });
		expect(parseColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
	});

	it('throws rather than returning black for an unreadable value', () => {
		expect(() => parseColor('var(--color-viz-9)')).toThrow();
	});
});

describe('composite', () => {
	it('flattens a translucent colour onto its backdrop', () => {
		const c = composite('rgba(0,0,0,0.5)', '#FFFFFF');
		expect(c.r).toBeCloseTo(127.5, 6);
		expect(c.a).toBe(1);
	});
});

describe('contrastRatio', () => {
	it('matches the WCAG extremes', () => {
		expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 6);
		expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 6);
	});

	it('is symmetric', () => {
		expect(contrastRatio('#1F4E79', '#FFFFFF')).toBeCloseTo(contrastRatio('#FFFFFF', '#1F4E79'), 9);
	});

	it('flattens a translucent background onto the page backdrop before comparing', () => {
		// The warning soft ground is 16% of #CA8A04 over white, ie. a very light wash.
		const onSoft = contrastRatio('#1B2330', 'rgba(202,138,4,0.16)');
		const onWhite = contrastRatio('#1B2330', '#FFFFFF');
		expect(onSoft).toBeLessThan(onWhite);
		expect(onSoft).toBeGreaterThan(10);
	});

	it('reports luminance in the expected order', () => {
		expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 6);
		expect(relativeLuminance('#000000')).toBeCloseTo(0, 6);
	});
});
