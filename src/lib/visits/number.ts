/**
 * Reading a number the way the machine in front of the operator writes one. Excel on the lab's
 * fr-CH machines writes `12,5` and `1'026`; `Number` reads neither, so a pasted block of
 * replicates wrote nothing at all.
 *
 * The locale decides: its decimal separator is the decimal point, its group separator is stripped,
 * and the API still receives a plain number. A cell the locale cannot account for, `12,5` where
 * the comma groups thousands, is refused rather than guessed at.
 */

export interface Separators {
	decimal: string;
	/** Every character that stands for this locale's group separator, ASCII spellings included. */
	group: string[];
}

const APOSTROPHES = ["'", '’', 'ʼ'];
const SPACES = [' ', ' ', ' ', ' '];

function spellings(group: string): string[] {
	if (APOSTROPHES.includes(group)) return APOSTROPHES;
	if (SPACES.includes(group)) return SPACES;
	return [group];
}

/** A Swiss locale reads both: ICU data spells it with a space before 78 and an apostrophe from 78. */
function swissSpellings(): string[] {
	return [...APOSTROPHES, ...SPACES];
}

function region(locale: string): string | undefined {
	try {
		return new Intl.Locale(locale).region;
	} catch {
		return undefined;
	}
}

/** The locale the operator's machine writes numbers in. */
export function browserLocale(): string {
	if (typeof navigator !== 'undefined' && navigator.language) return navigator.language;
	return new Intl.NumberFormat().resolvedOptions().locale;
}

/** The decimal and group separators a locale writes, read from the platform's own locale data. */
export function separatorsFor(locale: string): Separators {
	const parts = new Intl.NumberFormat(locale).formatToParts(1234567.5);
	const decimal = parts.find((p) => p.type === 'decimal')?.value ?? '.';
	const group = parts.find((p) => p.type === 'group')?.value ?? ',';
	return { decimal, group: region(locale) === 'CH' ? swissSpellings() : spellings(group) };
}

function charClass(chars: string[]): string {
	return `[${chars.map((c) => c.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')).join('')}]`;
}

/** Digits, grouped in threes by the locale's separator or not grouped at all. */
function readsAsInteger(text: string, group: string[]): boolean {
	if (/^\d+$/.test(text)) return true;
	return new RegExp(`^\\d{1,3}(?:${charClass(group)}\\d{3})+$`).test(text);
}

/**
 * A typed or pasted cell as a number, or null when the locale cannot read it. A cell holding
 * nothing is the caller's business: this reads what is there.
 */
export function readNumber(text: string, locale: string): number | null {
	const trimmed = text.trim();
	if (trimmed === '') return null;
	const shape = /^([-+]?)(.*?)([eE][-+]?\d+)?$/.exec(trimmed);
	if (!shape) return null;
	const [, sign, mantissa, exponent = ''] = shape;
	const { decimal, group } = separatorsFor(locale);

	// The other convention, unambiguously: a lone point where the locale groups with apostrophes.
	const held = ['.', ','].filter((c) => c !== decimal && !group.includes(c) && mantissa.includes(c));
	const written =
		!mantissa.includes(decimal) && !group.some((g) => mantissa.includes(g)) && held.length === 1
			? held[0]
			: decimal;

	const [integer, ...rest] = mantissa.split(written);
	if (rest.length > 1) return null;
	const fraction = rest[0] ?? '';
	if (fraction !== '' && !/^\d+$/.test(fraction)) return null;
	if (integer !== '' && !readsAsInteger(integer, group)) return null;
	if (integer === '' && fraction === '') return null;

	const plain = `${sign}${integer.replace(new RegExp(charClass(group), 'g'), '')}.${fraction || '0'}${exponent}`;
	const value = Number(plain);
	return Number.isFinite(value) ? value : null;
}

/**
 * A number as the locale writes it: the locale's decimal separator, and its grouping on a value
 * large enough to take one. This is what `readNumber` reads back, and what a spreadsheet on the
 * same machine expects from a copied block.
 *
 * `decimals` is the slot's declared precision; undeclared writes the number as it stands, which is
 * what a cell being typed into needs.
 */
export function writeNumber(value: number, locale: string, decimals?: number | null): string {
	if (!Number.isFinite(value)) return '';
	const precision =
		typeof decimals === 'number' && Number.isInteger(decimals) && decimals >= 0
			? { minimumFractionDigits: decimals, maximumFractionDigits: decimals }
			: { maximumFractionDigits: 20 };
	return new Intl.NumberFormat(locale, { useGrouping: true, ...precision }).format(value);
}
