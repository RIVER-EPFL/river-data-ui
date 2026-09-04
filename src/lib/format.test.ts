import { describe, expect, it } from 'vitest';
import { NO_VALUE, formatCount, formatMeasurement, formatSignificant, numericCell } from './format';

describe('formatMeasurement', () => {
	it('renders a value at the precision its slot declares', () => {
		expect(formatMeasurement(412.6987, 1)).toBe('412.7');
		expect(formatMeasurement(0.0031, 4)).toBe('0.0031');
		expect(formatMeasurement(8, 0)).toBe('8');
	});

	it('keeps the small values a two-decimal default rounded away when nothing is declared', () => {
		expect(formatMeasurement(0.0031, null)).toBe('0.0031');
		expect(formatMeasurement(412.6987)).toBe('412.699');
	});

	it('writes an absent or unusable value as the one placeholder', () => {
		expect(formatMeasurement(null)).toBe(NO_VALUE);
		expect(formatMeasurement(undefined, 2)).toBe(NO_VALUE);
		expect(formatMeasurement(Number.NaN, 2)).toBe(NO_VALUE);
		expect(formatMeasurement(Number.POSITIVE_INFINITY, 2)).toBe(NO_VALUE);
		expect(NO_VALUE).toBe('-');
	});

	it('ignores a declaration that is not a usable precision', () => {
		expect(formatMeasurement(1.23456789, -2)).toBe('1.23457');
		expect(formatMeasurement(1.23456789, Number.NaN)).toBe('1.23457');
	});
});

describe('formatCount', () => {
	// The reader's browser locale decided the grouping, so the same number read differently on
	// de-CH (1'234'567), fr-CH (a narrow no-break space) and de-DE (1.234.567).
	it('groups the same way whatever the browser locale is', () => {
		expect(formatCount(1234567)).toBe('1,234,567');
		// The three conventions a browser at EPFL Valais actually produces, none of which this
		// follows any more.
		for (const locale of ['de-DE', 'de-CH', 'fr-CH']) {
			expect(formatCount(1234567)).not.toBe((1234567).toLocaleString(locale));
		}
		expect(formatCount(0)).toBe('0');
		expect(formatCount(999)).toBe('999');
	});

	it('is a placeholder for a count that is not there', () => {
		expect(formatCount(null)).toBe(NO_VALUE);
	});
});

describe('formatSignificant', () => {
	it('is for coefficients and deltas, which no slot declares a precision for', () => {
		expect(formatSignificant(0.000123456789)).toBe('0.000123457');
		expect(formatSignificant(1.5)).toBe('1.5');
		expect(formatSignificant(null)).toBe(NO_VALUE);
	});
});

describe('numericCell', () => {
	it('right-aligns numbers in figures of one width', () => {
		expect(numericCell).toContain('text-right');
		expect(numericCell).toContain('tabular-nums');
	});
});
