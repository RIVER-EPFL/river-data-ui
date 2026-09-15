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
	return { decimal, group: spellings(group) };
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
