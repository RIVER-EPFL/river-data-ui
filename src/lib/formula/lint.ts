/// What the formula language defines, and what a formula naming something else is told.
///
/// The engine is the authority on save (`tools/formula.rs`); this is the same knowledge in front
/// of the author, so an unknown name is found while it is being typed rather than by the server
/// after the work is done. The tables below mirror `FORMULA_BUILTINS` and the guard functions the
/// evaluator registers; a name added there is added here.

/** How many arguments each function takes. `null` is variadic (meval's own `min` and `max`). */
export const FORMULA_FUNCTIONS: Record<string, number | null> = {
	sqrt: 1,
	abs: 1,
	ln: 1,
	log: 1,
	exp: 1,
	sin: 1,
	cos: 1,
	tan: 1,
	asin: 1,
	acos: 1,
	atan: 1,
	sinh: 1,
	cosh: 1,
	tanh: 1,
	floor: 1,
	ceil: 1,
	round: 1,
	signum: 1,
	min: null,
	max: null,
	if: 3,
	and: 2,
	or: 2,
	not: 1,
	lt: 2,
	le: 2,
	gt: 2,
	ge: 2,
	eq: 2,
	ne: 2,
	coalesce: 2,
	is_missing: 1,
};

/**
 * What each function is for, one line, shown as the palette entry's tooltip. The arithmetic ones
 * say what they compute; the guards say what they do with a value that is not there, which is
 * the half an author cannot infer from the name.
 */
export const FORMULA_FUNCTION_HELP: Record<string, string> = {
	sqrt: 'Square root',
	abs: 'Absolute value',
	ln: 'Natural logarithm',
	log: 'Logarithm base 10',
	exp: 'e raised to this power',
	sin: 'Sine, in radians',
	cos: 'Cosine, in radians',
	tan: 'Tangent, in radians',
	asin: 'Arcsine, in radians',
	acos: 'Arccosine, in radians',
	atan: 'Arctangent, in radians',
	sinh: 'Hyperbolic sine',
	cosh: 'Hyperbolic cosine',
	tanh: 'Hyperbolic tangent',
	floor: 'Round down to a whole number',
	ceil: 'Round up to a whole number',
	round: 'Round to the nearest whole number',
	signum: '-1, 0 or 1, by sign',
	min: 'The smallest of its arguments',
	max: 'The largest of its arguments',
	if: 'if(condition, then, else). A condition that is NA counts as false',
	and: 'True when both are true. NA counts as false',
	or: 'True when either is true. NA counts as false',
	not: 'True when the argument is false',
	lt: 'a < b. False when either is NA',
	le: 'a <= b. False when either is NA',
	gt: 'a > b. False when either is NA',
	ge: 'a >= b. False when either is NA',
	eq: 'a == b. False when either is NA',
	ne: 'a != b. False when either is NA',
	coalesce:
		'coalesce(a, b): a when the visit measured it, b otherwise. This is how a constant stands in for a value the visit does not carry',
	is_missing: 'True when the value is NA, so a formula can branch on what the visit did not measure'
};

/** Names the language defines that take no arguments. */
export const FORMULA_CONSTANTS = ['pi', 'e', 'na'] as const;

/** What each of those means. `na` is the value a calculation could not produce. */
export const FORMULA_CONSTANT_HELP: Record<string, string> = {
	pi: '3.14159...',
	e: "2.71828..., Euler's number",
	na: 'Not available: the value a calculation could not produce. Nothing is stored for it'
};

/** The two names a curve slot binds; offered only to a formula that declares one. */
export const CURVE_VARIABLES = ['curve_slope', 'curve_intercept'] as const;

export type DiagnosticKind =
	| 'unknown_identifier'
	| 'unbalanced_parenthesis'
	| 'wrong_argument_count'
	| 'self_reference';

export interface Diagnostic {
	kind: DiagnosticKind;
	message: string;
	/** The identifier the diagnostic is about, where it has one. */
	name?: string;
	/** The nearest known name, offered as the likely intent. */
	suggestion?: string;
}

/** What a formula may name besides the language's own. */
export interface KnownNames {
	/** Parameters and site properties the formula reads. */
	variables: string[];
	/** Named constants resolved server-side. */
	constants?: string[];
	/** Earlier formulas of the same calculation, readable by their code. */
	steps?: string[];
	/** Whether this formula declares a curve slot, which binds the two coefficients. */
	hasCurve?: boolean;
	/** The code of the formula being edited: naming itself is a cycle. */
	ownCode?: string;
}

const IDENTIFIER = /[A-Za-z_]\w*/g;

/** Every identifier the text names, in the order they appear, with the offset each starts at. */
export function identifiers(text: string): Array<{ name: string; at: number }> {
	const found: Array<{ name: string; at: number }> = [];
	for (const match of text.matchAll(IDENTIFIER)) {
		found.push({ name: match[0], at: match.index ?? 0 });
	}
	return found;
}

/** Levenshtein distance, for naming the nearest known identifier. */
function distance(a: string, b: string): number {
	const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
	for (let j = 1; j <= b.length; j++) rows[0]![j] = j;
	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			rows[i]![j] = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
		}
	}
	return rows[a.length]![b.length]!;
}

/**
 * The nearest known name, or nothing when none is near enough to be worth offering.
 *
 * A third of the length is the threshold: `Dissolved_Oxygen` against `Dissolved_O2` is worth
 * offering, `x` against `pH` is not.
 */
export function nearest(name: string, known: string[]): string | undefined {
	let best: { name: string; d: number } | null = null;
	for (const candidate of known) {
		const d = distance(name.toLowerCase(), candidate.toLowerCase());
		if (!best || d < best.d) best = { name: candidate, d };
	}
	if (!best) return undefined;
	return best.d <= Math.max(1, Math.floor(name.length / 3)) ? best.name : undefined;
}

/** Everything a formula may name, the language's own included. */
export function knownIdentifiers(known: KnownNames): string[] {
	return [
		...Object.keys(FORMULA_FUNCTIONS),
		...FORMULA_CONSTANTS,
		...(known.hasCurve ? CURVE_VARIABLES : []),
		...known.variables,
		...(known.constants ?? []),
		...(known.steps ?? []),
	];
}

/** The call the caret sits inside, and which argument it is on: what a signature hint reads. */
export function callAt(
	text: string,
	caret: number,
): { name: string; arity: number | null; argument: number } | null {
	let depth = 0;
	for (let i = Math.min(caret, text.length) - 1; i >= 0; i--) {
		const c = text[i]!;
		if (c === ')') depth++;
		else if (c === '(') {
			if (depth > 0) {
				depth--;
				continue;
			}
			const before = text.slice(0, i);
			const name = /([A-Za-z_]\w*)$/.exec(before)?.[1];
			if (!name || !(name in FORMULA_FUNCTIONS)) return null;
			let argument = 0;
			let inner = 0;
			for (let j = i + 1; j < Math.min(caret, text.length); j++) {
				const d = text[j]!;
				if (d === '(') inner++;
				else if (d === ')') inner--;
				else if (d === ',' && inner === 0) argument++;
			}
			return { name, arity: FORMULA_FUNCTIONS[name]!, argument };
		}
	}
	return null;
}

/** The names worth offering for a prefix, functions and constants after the author's own names. */
export function completionsFor(prefix: string, known: KnownNames): string[] {
	const q = prefix.trim().toLowerCase();
	const own = [...known.variables, ...(known.constants ?? []), ...(known.steps ?? [])];
	const language = [
		...Object.keys(FORMULA_FUNCTIONS),
		...FORMULA_CONSTANTS,
		...(known.hasCurve ? CURVE_VARIABLES : []),
	];
	const matches = (name: string) => !q || name.toLowerCase().startsWith(q);
	return [...own.filter(matches), ...language.filter(matches)];
}

/** The arguments one call carries, split on the commas of its own depth. */
function argumentsOf(text: string, open: number): number {
	let depth = 0;
	let count = 1;
	let sawContent = false;
	for (let i = open + 1; i < text.length; i++) {
		const c = text[i]!;
		if (c === '(') depth++;
		else if (c === ')') {
			if (depth === 0) return sawContent ? count : 0;
			depth--;
		} else if (c === ',' && depth === 0) count++;
		if (!/\s/.test(c) && c !== ')') sawContent = true;
	}
	return sawContent ? count : 0;
}

/**
 * Every diagnostic the text carries, in the order they are met.
 *
 * The parentheses are checked first: a formula that does not balance makes every later reading of
 * it a guess, so nothing after that is reported for the same text.
 */
export function lintFormula(text: string, known: KnownNames): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	let depth = 0;
	for (const c of text) {
		if (c === '(') depth++;
		else if (c === ')') {
			depth--;
			if (depth < 0) break;
		}
	}
	if (depth !== 0) {
		diagnostics.push({
			kind: 'unbalanced_parenthesis',
			message:
				depth > 0
					? `${depth} parenthesis${depth === 1 ? '' : 'es'} is not closed`
					: 'a closing parenthesis has nothing open',
		});
		return diagnostics;
	}

	const allowed = knownIdentifiers(known);
	const suggestable = [...known.variables, ...(known.constants ?? []), ...(known.steps ?? [])];
	for (const { name, at } of identifiers(text)) {
		const isCall = /^\s*\(/.test(text.slice(at + name.length));
		if (isCall) {
			const arity = FORMULA_FUNCTIONS[name];
			if (arity === undefined) {
				diagnostics.push({
					kind: 'unknown_identifier',
					name,
					message: `'${name}' is not a function of the formula language`,
					suggestion: nearest(name, Object.keys(FORMULA_FUNCTIONS)),
				});
				continue;
			}
			const open = text.indexOf('(', at + name.length);
			const given = argumentsOf(text, open);
			if (arity !== null && given !== arity) {
				diagnostics.push({
					kind: 'wrong_argument_count',
					name,
					message: `${name} takes ${arity} argument${arity === 1 ? '' : 's'}, ${given} given`,
				});
			}
			continue;
		}
		if (known.ownCode && name === known.ownCode) {
			diagnostics.push({
				kind: 'self_reference',
				name,
				message: `'${name}' is this formula's own output; a formula cannot read what it writes`,
			});
			continue;
		}
		if (!allowed.includes(name)) {
			diagnostics.push({
				kind: 'unknown_identifier',
				name,
				message: `'${name}' is not a parameter, constant or step this formula can read`,
				suggestion: nearest(name, suggestable),
			});
		}
	}
	return diagnostics;
}
