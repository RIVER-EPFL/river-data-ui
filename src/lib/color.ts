export interface Rgb {
	r: number;
	g: number;
	b: number;
	a: number;
}

/** Parse `#RGB`, `#RRGGBB`, `rgb(r,g,b)` or `rgba(r,g,b,a)`. Throws on anything else. */
export function parseColor(value: string): Rgb {
	const v = value.trim();
	if (v.startsWith('#')) {
		const hex = v.slice(1);
		const expand = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
		if (expand.length !== 6) throw new Error(`unparseable colour: ${value}`);
		return {
			r: parseInt(expand.slice(0, 2), 16),
			g: parseInt(expand.slice(2, 4), 16),
			b: parseInt(expand.slice(4, 6), 16),
			a: 1,
		};
	}
	const m = v.match(/^rgba?\(([^)]+)\)$/);
	if (!m) throw new Error(`unparseable colour: ${value}`);
	const parts = m[1].split(/[,/\s]+/).filter(Boolean).map(Number);
	if (parts.length < 3 || parts.some(Number.isNaN)) throw new Error(`unparseable colour: ${value}`);
	return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
}

/** Flatten a translucent colour onto an opaque backdrop. */
export function composite(color: string, backdrop: string): Rgb {
	const f = parseColor(color);
	const b = parseColor(backdrop);
	return {
		r: f.r * f.a + b.r * (1 - f.a),
		g: f.g * f.a + b.g * (1 - f.a),
		b: f.b * f.a + b.b * (1 - f.a),
		a: 1,
	};
}

function channelLuminance(c: number): number {
	const s = c / 255;
	return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.1 relative luminance. The colour is flattened onto white if translucent. */
export function relativeLuminance(color: string): number {
	const c = parseColor(color).a === 1 ? parseColor(color) : composite(color, '#FFFFFF');
	return (
		0.2126 * channelLuminance(c.r) + 0.7152 * channelLuminance(c.g) + 0.0722 * channelLuminance(c.b)
	);
}

/** WCAG 2.1 contrast ratio, 1 to 21. Each colour is flattened onto `backdrop` first. */
export function contrastRatio(foreground: string, background: string, backdrop = '#FFFFFF'): number {
	const fg = rgbString(composite(foreground, rgbString(composite(background, backdrop))));
	const bg = rgbString(composite(background, backdrop));
	const l1 = relativeLuminance(fg);
	const l2 = relativeLuminance(bg);
	const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
	return (hi + 0.05) / (lo + 0.05);
}

function rgbString(c: Rgb): string {
	return `rgb(${c.r},${c.g},${c.b})`;
}

/** CIE L*a*b*, D65, for perceptual distance. */
export function lab(color: string): [number, number, number] {
	const c = composite(color, '#FFFFFF');
	const [r, g, b] = [c.r, c.g, c.b].map(channelLuminance);
	const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
	const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
	const t = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
	const [fx, fy, fz] = [t(x), t(y), t(z)];
	return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const CVD_MATRICES: Record<'deuteranopia' | 'protanopia', number[][]> = {
	deuteranopia: [
		[0.29275, 0.70726, 0],
		[0.29275, 0.70726, 0],
		[-0.02234, 0.02234, 1],
	],
	protanopia: [
		[0.11238, 0.88762, 0],
		[0.11238, 0.88762, 0],
		[0.00401, -0.00401, 1],
	],
};

export type ColorVision = keyof typeof CVD_MATRICES;

/** Vienot dichromat simulation, for checking that two series stay tellable apart. */
export function simulate(color: string, vision: ColorVision): string {
	const c = composite(color, '#FFFFFF');
	const linear = [c.r, c.g, c.b].map(channelLuminance);
	const m = CVD_MATRICES[vision];
	const out = m.map((row) => row.reduce((acc, k, i) => acc + k * linear[i], 0));
	const encode = (v: number) => {
		const x = Math.min(1, Math.max(0, v));
		return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055));
	};
	const [r, g, b] = out.map(encode);
	return `rgb(${r},${g},${b})`;
}

/** CIE76 distance between two colours, taken as the worst of normal and dichromat vision. */
export function perceptualDistance(a: string, b: string): number {
	const views: (string | ColorVision)[] = ['normal', 'deuteranopia', 'protanopia'];
	return Math.min(
		...views.map((v) => {
			const [la, lb] =
				v === 'normal'
					? [lab(a), lab(b)]
					: [lab(simulate(a, v as ColorVision)), lab(simulate(b, v as ColorVision))];
			return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
		}),
	);
}

/** The closest any two colours in a palette come, under normal and dichromat vision. */
export function minSeparation(palette: string[]): number {
	let min = Infinity;
	for (let i = 0; i < palette.length; i++) {
		for (let j = i + 1; j < palette.length; j++) {
			min = Math.min(min, perceptualDistance(palette[i], palette[j]));
		}
	}
	return min;
}
