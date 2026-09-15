import { describe, expect, it } from 'vitest';

import { readNumber, separatorsFor } from './number';

describe('separatorsFor', () => {
	it('reads the separators of the Swiss locales the lab runs', () => {
		expect(separatorsFor('fr-CH').decimal).toBe(',');
		expect(separatorsFor('fr-CH').group).toContain("'");
		expect(separatorsFor('de-CH').decimal).toBe('.');
		expect(separatorsFor('de-CH').group).toContain("'");
		expect(separatorsFor('en-US')).toEqual({ decimal: '.', group: [','] });
	});
});

describe('readNumber', () => {
	it('reads a comma decimal on fr-CH and a point decimal on de-CH and en-US', () => {
		expect(readNumber('12,5', 'fr-CH')).toBe(12.5);
		expect(readNumber('12.5', 'de-CH')).toBe(12.5);
		expect(readNumber('12.5', 'en-US')).toBe(12.5);
	});

	it('strips the group separator the locale writes', () => {
		expect(readNumber("1'026", 'fr-CH')).toBe(1026);
		expect(readNumber("1'026", 'de-CH')).toBe(1026);
		expect(readNumber('1 234,5', 'fr-FR')).toBe(1234.5);
		expect(readNumber('1 234,5', 'fr-FR')).toBe(1234.5);
		expect(readNumber('1,234.5', 'en-US')).toBe(1234.5);
		expect(readNumber('1,234', 'en-US')).toBe(1234);
	});

	it('refuses a cell the locale cannot account for', () => {
		// The comma groups thousands on en-US, and no grouping puts one digit after it.
		expect(readNumber('12,5', 'en-US')).toBeNull();
		expect(readNumber('1.234,5', 'en-US')).toBeNull();
		expect(readNumber('12,5,6', 'fr-CH')).toBeNull();
		expect(readNumber('n/d', 'fr-CH')).toBeNull();
		expect(readNumber('12 mg', 'de-CH')).toBeNull();
		expect(readNumber('', 'fr-CH')).toBeNull();
	});

	it('takes the other convention when the locale leaves it unambiguous', () => {
		// A point is neither separator on fr-CH, so a de-CH sheet still pastes.
		expect(readNumber('12.5', 'fr-CH')).toBe(12.5);
	});

	it('reads a cell as it is being typed', () => {
		expect(readNumber('12,', 'fr-CH')).toBe(12);
		expect(readNumber('12.', 'de-CH')).toBe(12);
		expect(readNumber(',5', 'fr-CH')).toBe(0.5);
		expect(readNumber('-3,5', 'fr-CH')).toBe(-3.5);
	});

	it('keeps the shapes a sheet exports beside the plain ones', () => {
		expect(readNumber('1.2E-05', 'de-CH')).toBe(1.2e-5);
		expect(readNumber('1,2e3', 'fr-CH')).toBe(1200);
		expect(readNumber('  12,5  ', 'fr-CH')).toBe(12.5);
		expect(readNumber('0', 'en-US')).toBe(0);
	});
});
