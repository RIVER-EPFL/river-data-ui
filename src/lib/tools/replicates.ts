// Params named `{base}_rep_{letter}` are one measurement entered once per replicate. The manifest
// declares them flat, one param per cell, which is what the portal's own column names are; the grid
// is derived from those names here so the run form and the authoring params table agree on what a
// family is.

import type { ToolParam } from '$api/service';

export const REP_SEPARATOR = '_rep_';
export const REP_NAME = /^(.+)_rep_([A-Za-z0-9]{1,3})$/;
export const REP_LABEL_SUFFIX = /\s*\(replicate\s+([^)]*)\)\s*$/i;

export const repName = (base: string, letter: string) => `${base}${REP_SEPARATOR}${letter}`;

/** The base and letter a param name carries, or null when it is not a family member. */
export function splitRepName(name: string): { base: string; letter: string } | null {
	const m = REP_NAME.exec(name);
	return m ? { base: m[1], letter: m[2] } : null;
}

/** The measurement's own label, without the `(replicate X)` the members carry. */
export const stripRepLabel = (label: string) => label.replace(REP_LABEL_SUFFIX, '');

/**
 * A member label for `letter`, keeping whatever suffix style `sample` uses. A member whose label
 * names no replicate keeps naming none, so an edit changes the stem and nothing else.
 */
export function repLabel(stem: string, letter: string, sample: string): string {
	return REP_LABEL_SUFFIX.test(sample) ? `${stem} (replicate ${letter})` : stem;
}

export interface ReplicateMember {
	letter: string;
	param: ToolParam;
	/** Position in the params array, which every edit writes back through. */
	index: number;
}

/** A field an author sets per param, which the family can only edit as one when they agree. */
export type VaryingField = 'label' | 'kind' | 'units' | 'required' | 'default' | 'when';

export interface ReplicateFamily {
	base: string;
	/** The shared label, or the first member's when they disagree. */
	label: string;
	units: string | null;
	kind: string;
	required: boolean;
	letters: string[];
	members: ReplicateMember[];
	byLetter: Map<string, ReplicateMember>;
	/** Where the family renders: the declared position of its first member. */
	firstIndex: number;
	/** Fields the members do not all share, which cannot be edited as one. */
	varies: Set<VaryingField>;
}

export interface ReplicateView {
	families: ReplicateFamily[];
	/** Every letter any family uses, in first-seen order: the columns of the grid. */
	letters: string[];
	/** Indices of every param belonging to a family. */
	memberIndices: Set<number>;
}

const KINDS = new Set(['number', 'integer']);

/**
 * Columns read in symbol order rather than in the order the families happen to declare them: with
 * a ragged family the first-seen order would put a letter one measurement is missing after the
 * ones that follow it.
 */
export const compareLetters = (a: string, b: string) =>
	a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

const sameDefault = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The families a flat param list contains. A base with a single member stays an ordinary param:
 * one cell is not a grid, and grouping it would hide it behind a disclosure for nothing.
 */
export function replicateFamilies(params: ToolParam[]): ReplicateView {
	const bases = new Map<string, ReplicateMember[]>();
	params.forEach((param, index) => {
		if (!KINDS.has(param.kind)) return;
		const split = splitRepName(param.name);
		if (!split) return;
		const members = bases.get(split.base) ?? [];
		members.push({ letter: split.letter, param, index });
		bases.set(split.base, members);
	});

	const families: ReplicateFamily[] = [];
	const memberIndices = new Set<number>();
	for (const [base, members] of bases) {
		if (members.length < 2) continue;
		const first = members[0].param;
		const varies = new Set<VaryingField>();
		for (const m of members) {
			if (stripRepLabel(m.param.label) !== stripRepLabel(first.label)) varies.add('label');
			if (m.param.kind !== first.kind) varies.add('kind');
			if ((m.param.units ?? null) !== (first.units ?? null)) varies.add('units');
			if (m.param.required !== first.required) varies.add('required');
			if (!sameDefault(m.param.default, first.default)) varies.add('default');
			if (JSON.stringify(m.param.when ?? null) !== JSON.stringify(first.when ?? null)) varies.add('when');
		}
		for (const m of members) memberIndices.add(m.index);
		families.push({
			base,
			label: stripRepLabel(first.label),
			units: first.units ?? null,
			kind: first.kind,
			required: first.required,
			letters: members.map((m) => m.letter),
			members,
			byLetter: new Map(members.map((m) => [m.letter, m])),
			firstIndex: members[0].index,
			varies,
		});
	}
	families.sort((a, b) => a.firstIndex - b.firstIndex);

	const letters = new Set<string>();
	for (const f of families) for (const letter of f.letters) letters.add(letter);
	return { families, letters: [...letters].sort(compareLetters), memberIndices };
}

/** Whether the family's symbols read as letters, which decides what the next one is. */
export const usesLetters = (letters: string[]) => letters.every((l) => /^[A-Za-z]$/.test(l));

/** The next symbol not already used, in the style the family already writes. */
export function nextLetter(letters: string[]): string {
	if (usesLetters(letters)) {
		const upper = letters.some((l) => l === l.toUpperCase());
		for (let i = 0; i < 26; i++) {
			const candidate = String.fromCharCode((upper ? 65 : 97) + i);
			if (!letters.includes(candidate)) return candidate;
		}
	}
	for (let n = 1; ; n++) {
		if (!letters.includes(String(n))) return String(n);
	}
}

/**
 * Where a new `letter` of `base` belongs: in symbol order among the base's existing members, so
 * the family stays contiguous and the saved param list keeps reading in the order of the grid.
 */
export function insertionIndex(params: ToolParam[], base: string, letter?: string): number {
	let last = -1;
	for (const [i, p] of params.entries()) {
		const split = splitRepName(p.name);
		if (!split || split.base !== base) continue;
		if (letter !== undefined && compareLetters(split.letter, letter) > 0) return i;
		last = i;
	}
	return last === -1 ? params.length : last + 1;
}

export function insertAt<T>(list: T[], index: number, item: T): T[] {
	const next = [...list];
	next.splice(index, 0, item);
	return next;
}
