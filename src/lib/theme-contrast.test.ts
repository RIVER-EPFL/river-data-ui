import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from './color';
import { tokens } from './charts/tokens';
import { tooltipRow } from './charts/legend';
import { minSeparation } from './color';

const css = readFileSync(fileURLToPath(new URL('../app.css', import.meta.url)), 'utf-8');

function cssToken(name: string): string {
	const m = css.match(new RegExp(`--color-${name}:\\s*([^;]+);`));
	if (!m) throw new Error(`--color-${name} is not declared in app.css`);
	return m[1].trim();
}

const surface = cssToken('brand-surface');

describe('severity tokens carry body text at 4.5:1', () => {
	// Every severity main is used as `text-severity-*` on the white surface, and the warning
	// and alarm ones also sit on their own soft ground inside a Badge.
	for (const severity of ['ok', 'warning', 'alarm'] as const) {
		it(`${severity} on the surface`, () => {
			expect(contrastRatio(cssToken(`severity-${severity}`), surface)).toBeGreaterThanOrEqual(4.5);
		});

		it(`${severity} on its own soft ground`, () => {
			const soft = cssToken(`severity-${severity}-soft`);
			expect(contrastRatio(cssToken(`severity-${severity}`), soft, surface)).toBeGreaterThanOrEqual(
				4.5,
			);
		});
	}

	it('the accent pill text clears the accent wash it sits on', () => {
		expect(
			contrastRatio(cssToken('brand-accent-dark'), 'rgba(199,119,0,0.15)', surface),
		).toBeGreaterThanOrEqual(4.5);
	});
});

describe('the data viz palette is legible where it is drawn', () => {
	const palette = Array.from({ length: 8 }, (_, i) => cssToken(`viz-${i}`));

	it('mirrors the chart tokens module', () => {
		expect(palette.map((c) => c.toUpperCase())).toEqual(tokens.dataViz.map((c) => c.toUpperCase()));
	});

	// A 1.5px line is a non-text graphic: WCAG asks 3:1 against what it is drawn on.
	for (let i = 0; i < 8; i++) {
		it(`entry ${i} is a visible line on the plot area`, () => {
			expect(contrastRatio(palette[i], surface)).toBeGreaterThanOrEqual(3);
		});
	}

	// The shared tooltip prints one row per series on a near-black ground.
	for (let i = 0; i < 8; i++) {
		it(`entry ${i} names its series legibly on the tooltip ground`, () => {
			const row = tooltipRow({ color: palette[i] });
			expect(contrastRatio(row.name, tokens.chart.tooltipBg, tokens.brand.text)).toBeGreaterThanOrEqual(
				4.5,
			);
		});
	}

	it('outlines the tooltip swatch, so a dark entry is still a visible chip', () => {
		expect(tooltipRow({ color: palette[7] }).swatch).toMatch(/box-shadow/);
	});

	it('separates its entries at least as well as the palette it replaced, under deuteranopia and protanopia', () => {
		// Okabe-Ito, the palette in the tree before the on-white contrast floor was applied.
		const previous = ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#56B4E9', '#E69F00', '#F0E442', '#000000'];
		expect(minSeparation(palette)).toBeGreaterThanOrEqual(minSeparation(previous));
	});
});

describe('color scheme', () => {
	it('body declares the light scheme, so native controls are not dark inside white cards', () => {
		const body = css.match(/\nbody\s*\{([^}]*)\}/);
		expect(body).not.toBeNull();
		expect(body![1]).toMatch(/color-scheme:\s*light/);
	});
});

describe('components colour with the brand tokens', () => {
	const root = fileURLToPath(new URL('..', import.meta.url));
	const sources = readdirSync(root, { recursive: true, encoding: 'utf-8' })
		.filter((f) => /\.(svelte|ts|css)$/.test(f) && !/\.test\.ts$/.test(f))
		.map((f) => ({ file: f, text: readFileSync(`${root}/${f}`, 'utf-8') }));

	it('uses no Tailwind grey palette class', () => {
		const grey = /\b(?:text|border|bg|divide|ring|placeholder)-(?:gray|slate|zinc|neutral|stone)-\d+/g;
		const found = sources.flatMap(({ file, text }) => (text.match(grey) ?? []).map((c) => `${file}: ${c}`));
		expect(found).toEqual([]);
	});

	it('reads only colour variables app.css declares', () => {
		const undeclared = sources.flatMap(({ file, text }) =>
			[...text.matchAll(/var\(--color-([A-Za-z0-9-]+)/g)]
				.map((m) => m[1])
				.filter((name) => !css.includes(`--color-${name}:`))
				.map((name) => `${file}: --color-${name}`),
		);
		expect(undeclared).toEqual([]);
	});
});
