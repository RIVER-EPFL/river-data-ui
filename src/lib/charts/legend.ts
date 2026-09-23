import { tokens, withAlpha } from './tokens';

/**
 * Dash patterns applied once the palette has been spent. A chart-sync group holds every series a
 * page registers, measurement and device health together, so the colour alone stops identifying a
 * series past the eighth one.
 */
const DASH_PATTERNS: number[][] = [
	[6, 4],
	[2, 3],
	[10, 4, 2, 4],
];

export interface SeriesKey {
	color: string;
	dash?: number[];
}

/** The series colour for a registration index, wrapping at the palette length. */
export function seriesColor(index: number): string {
	return tokens.dataViz[index % tokens.dataViz.length];
}

/** The dash pattern for a registration index: solid for the first cycle, then one per cycle. */
function seriesDash(index: number): number[] | undefined {
	const cycle = Math.floor(index / tokens.dataViz.length);
	return cycle === 0 ? undefined : DASH_PATTERNS[(cycle - 1) % DASH_PATTERNS.length];
}

/** How a series is drawn and keyed: its colour, dashed once the palette has been spent. */
export function seriesKey(index: number): SeriesKey {
	return { color: seriesColor(index), dash: seriesDash(index) };
}

/** Diamond fill and stroke for a series' spot points: its own colour, the shape carrying cadence. */
export function spotMarkerColors(index: number): { fill: string; stroke: string } {
	const color = seriesColor(index);
	return { fill: withAlpha(color, 0.45), stroke: color };
}

/**
 * A legend swatch: the series colour, striped when the series is drawn dashed, and outlined so a
 * dark entry is still bounded on the dark tooltip ground where the fill alone would vanish.
 */
export function swatchStyle({ color, dash }: SeriesKey): string {
	const outline = 'box-shadow:0 0 0 1px rgba(255,255,255,0.85)';
	if (!dash || dash.length < 2) return `background:${color};${outline}`;
	const on = dash[0];
	const off = dash[1];
	return (
		`background:repeating-linear-gradient(90deg,${color} 0 ${on}px,transparent ${on}px ${on + off}px);` +
		outline
	);
}

/**
 * The tooltip's series row. The colour is the swatch's job; the name is printed in the tooltip's
 * own text colour, because a palette chosen to be legible on the white plot area is not legible
 * as text on the dark tooltip.
 */
export function tooltipRow(key: SeriesKey): { swatch: string; name: string } {
	return { swatch: swatchStyle(key), name: tokens.chart.tooltipText };
}
