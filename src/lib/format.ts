// The one place a number becomes text. A measurement's precision is the slot's declaration
// (`site_parameters.decimal_places`), never the surface it happens to be drawn on; counts group the
// same way for every reader; and an absent value is one glyph everywhere.

/** The placeholder for a value that is not there. Never an em dash (`~/projects/style.md`). */
export const NO_VALUE = '-';

/** Digit grouping is explicit, so a de-CH or fr-CH browser renders what an en-US one does. */
const COUNT_LOCALE = 'en-US';

/** Significant digits for a value whose slot declares no precision. */
const FALLBACK_DIGITS = 6;

/**
 * Class for a table cell or grid value holding a number: right-aligned, one width per figure.
 * Mono digits are already tabular; `tabular-nums` holds the alignment if the face falls back.
 */
export const numericCell = 'text-right font-mono tabular-nums';

function usable(value: number | null | undefined): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function trimmed(value: number, digits: number): string {
	return String(Number(value.toPrecision(digits)));
}

/**
 * A measured value at its slot's declared precision. `decimals` is
 * `site_parameters.decimal_places`; undeclared falls back to six significant digits, which keeps a
 * value smaller than a fixed decimal would round away.
 */
export function formatMeasurement(
	value: number | null | undefined,
	decimals?: number | null,
): string {
	if (!usable(value)) return NO_VALUE;
	if (typeof decimals === 'number' && Number.isInteger(decimals) && decimals >= 0) {
		return value.toFixed(decimals);
	}
	return trimmed(value, FALLBACK_DIGITS);
}

/** A coefficient, a delta or a ratio: nothing declares a precision for these. */
export function formatSignificant(value: number | null | undefined, digits = FALLBACK_DIGITS): string {
	if (!usable(value)) return NO_VALUE;
	return trimmed(value, digits);
}

/** A count of rows, readings or instants. */
export function formatCount(value: number | null | undefined): string {
	if (!usable(value)) return NO_VALUE;
	return value.toLocaleString(COUNT_LOCALE);
}
