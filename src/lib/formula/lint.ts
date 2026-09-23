import { unparsed } from '$components/formula/ast';

/// What the formula language defines, and what a formula naming something else is told.
///
/// The engine is the authority on save (`tools/formula.rs`); this is the same knowledge in front
/// of the author, so an unknown name is found while it is being typed rather than by the server
/// after the work is done. The tables below mirror `FORMULA_BUILTINS` and the guard functions the
/// evaluator registers; a name added there is added here.

/**
 * How many arguments each function takes. `null` is variadic (meval's own `min` and `max`).
 *
 * `mean` and `sd` take a replicate family by name rather than a number, so their one argument is
 * an identifier: the engine resolves them over the whole family before the expression runs.
 */
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
	mean: 1,
	sd: 1,
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
	is_missing:
		'True when the value is NA, so a formula can branch on what the visit did not measure',
	mean: 'mean(x): the average of a replicate family. A repeat that was not measured is left out',
	sd: 'sd(x): the standard deviation of a replicate family, over n-1. NA under two repeats'
};

/** Names the language defines that take no arguments. */
export const FORMULA_CONSTANTS = ['pi', 'e', 'na'] as const;

/** The two names a curve slot binds; offered only to a formula that declares one. */
export const CURVE_VARIABLES = ['curve_slope', 'curve_intercept'] as const;

export type DiagnosticKind =
	| 'unknown_identifier'
	| 'unbalanced_parenthesis'
	| 'wrong_argument_count'
	| 'self_reference'
	| 'trailing_text';

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
	/** The human label of each variable, so a completion is found by the label too. */
	labels?: Record<string, string>;
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

/** What a completion is, so the list can group what it offers by where the name comes from. */
export type CompletionKind = 'parameter' | 'step' | 'constant' | 'function' | 'curve';

export interface Completion {
	/** The name inserted into the formula. */
	name: string;
	kind: CompletionKind;
	/** The human label of a parameter, where it has one that differs from the name. */
	label?: string;
}

/** How many names the list offers at once. */
export const MAX_COMPLETIONS = 12;

/** Whether every character of `q` appears in `name`, in order but not adjacently. */
function subsequence(name: string, q: string): boolean {
	let i = 0;
	for (const c of name) {
		if (c === q[i]) i++;
		if (i === q.length) return true;
	}
	return q.length === 0;
}

/**
 * How well a name answers what is being typed: 0 is a prefix, 1 a substring, 2 the letters in
 * order, 3 a near miss by edit distance. Anything further is not offered.
 */
function rank(name: string, q: string): number {
	const lower = name.toLowerCase();
	if (lower.startsWith(q)) return 0;
	if (lower.includes(q)) return 1;
	if (subsequence(lower, q)) return 2;
	return nearest(q, [name]) ? 3 : 4;
}

/**
 * The names worth offering for what the caret is on, the author's own before the language's and
 * the closest match of each first.
 *
 * Matching is fuzzy: a parameter is found by any run of its letters, by a piece of its label, or
 * by a spelling near enough that the author meant it.
 */
export function completionsFor(prefix: string, known: KnownNames): Completion[] {
	const q = prefix.trim().toLowerCase();
	const own: Completion[] = [
		...known.variables.map((name) => ({
			name,
			kind: 'parameter' as const,
			label: known.labels?.[name],
		})),
		...(known.steps ?? []).map((name) => ({ name, kind: 'step' as const })),
		...(known.constants ?? []).map((name) => ({ name, kind: 'constant' as const })),
	];
	const language: Completion[] = [
		...Object.keys(FORMULA_FUNCTIONS).map((name) => ({ name, kind: 'function' as const })),
		...FORMULA_CONSTANTS.map((name) => ({ name, kind: 'constant' as const })),
		...(known.hasCurve ? CURVE_VARIABLES.map((name) => ({ name, kind: 'curve' as const })) : []),
	];
	const scored: Array<{ completion: Completion; score: number; order: number }> = [];
	for (const [group, list] of [own, language].entries()) {
		list.forEach((completion, i) => {
			const score = q
				? Math.min(rank(completion.name, q), completion.label ? rank(completion.label, q) : 4)
				: 0;
			if (score > 3) return;
			scored.push({ completion, score: score * 2 + group, order: i });
		});
	}
	scored.sort((a, b) => a.score - b.score || a.order - b.order);
	return scored.slice(0, MAX_COMPLETIONS).map((s) => s.completion);
}

/** The identifier the caret sits in the middle or at the end of, and where it starts and ends. */
export function identifierAt(
	text: string,
	caret: number,
): { prefix: string; start: number; end: number } | null {
	const at = Math.max(0, Math.min(caret, text.length));
	let start = at;
	while (start > 0 && /\w/.test(text[start - 1]!)) start--;
	if (start === at) return null;
	if (!/[A-Za-z_]/.test(text[start]!)) return null;
	let end = at;
	while (end < text.length && /\w/.test(text[end]!)) end++;
	return { prefix: text.slice(start, at), start, end };
}

/** The text and caret that accepting `name` at the caret leaves behind. */
export function applyCompletion(
	text: string,
	caret: number,
	name: string,
): { text: string; caret: number } {
	const target = identifierAt(text, caret);
	if (!target) return { text, caret };
	return {
		text: text.slice(0, target.start) + name + text.slice(target.end),
		caret: target.start + name.length,
	};
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

	const left = unparsed(text);
	if (left !== '') {
		diagnostics.push({
			kind: 'trailing_text',
			message: `the expression ends before '${left}': an operator is missing between them`,
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
