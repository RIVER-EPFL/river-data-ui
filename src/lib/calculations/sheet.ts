import type { InputRow } from './editor';
import { dependencyOrder, type EditableFormula } from './editor';
import { identifiers } from '$lib/formula/lint';
import type { RunCell, RunInputTables, RunTables } from '$lib/tools/runTable';
import type { RunTraceStep } from '$api/service';

/// A calculation as the portal draws it: three tables side by side, parameters down and replicate
/// letters across. What the visit and the catalog supplied is on the left, the steps of the
/// calculation in the middle, and what it publishes with the statistics of the repeats on the
/// right. The rows come from the formula set, so the tables stand before any run; a run fills
/// their cells.

/** Where a row sits within its block. */
export type SheetBand =
	'replicated' | 'single' | 'fixed' | 'step' | 'read' | 'final' | 'statistics';

export type SheetBlockKey = 'inputs' | 'steps' | 'outputs';

export interface SheetRow {
	/** Unique within the block: the input's name, the formula's code, the statistic's key. */
	key: string;
	band: SheetBand;
	label: string;
	units: string | null;
	/** The formula behind the row, or where the value came from. */
	note: string | null;
	/** The formula's code, on a row the set computes. Null on an input and on a statistic. */
	code: string | null;
	/** Nothing in the set reads it: a step computed for no one, an input no formula names. */
	unused: boolean;
	/** On a statistic, the output whose repeats it summarises. */
	aggregateOf?: string | null;
	cells: RunCell[];
}

export interface SheetBlock {
	key: SheetBlockKey;
	title: string;
	/** The replicate letters every block is drawn against. Empty for a calculation that ran once. */
	columns: string[];
	rows: SheetRow[];
}

/** An input the author brought in before a formula named it. */
export interface DeclaredInput {
	name: string;
	kind: InputRow['kind'];
	detail: string;
}

const BAND_OF_KIND: Record<InputRow['kind'], SheetBand | null> = {
	replicates: 'replicated',
	parameter: 'single',
	constant: 'fixed',
	curve: 'fixed',
	other: 'fixed',
	step: null,
};

function emptyCells(width: number): RunCell[] {
	return Array.from({ length: Math.max(1, width) }, () => ({
		value: null,
		skipped: null,
	}));
}

/** The codes the set names in one formula, less the language and its own code. */
function readsOf(formula: Pick<EditableFormula, 'code' | 'formula'>, codes: Set<string>): string[] {
	const own = formula.code.trim();
	return [
		...new Set(
			identifiers(formula.formula)
				.map(({ name }) => name)
				.filter((name) => name !== own && codes.has(name)),
		),
	];
}

/** What a formula reads of the set, and which of the set's formulas read it. */
export function linksOf(
	formulas: Array<Pick<EditableFormula, 'code' | 'formula'>>,
	code: string,
): { reads: string[]; readBy: string[] } {
	const codes = new Set(formulas.map((f) => f.code.trim()).filter(Boolean));
	const wanted = code.trim();
	const self = formulas.find((f) => f.code.trim() === wanted);
	return {
		reads: self ? readsOf(self, codes) : [],
		readBy: formulas
			.filter((f) => f.code.trim() !== wanted && readsOf(f, codes).includes(wanted))
			.map((f) => f.code.trim()),
	};
}

/**
 * The three blocks, from the set and from a run of it.
 *
 * `run` is what the run was given and `tables` what it computed; without either the blocks still
 * carry a row per input, step and output, with empty cells. Every block is drawn against the same
 * replicate letters, so the three tables line up side by side.
 */
export function sheetBlocks(
	formulas: EditableFormula[],
	inputs: InputRow[],
	declared: DeclaredInput[] = [],
	run?: RunInputTables,
	tables?: RunTables,
): SheetBlock[] {
	const columns = [...new Set([...(run?.columns ?? []), ...(tables?.columns ?? [])])].sort((a, b) =>
		a.localeCompare(b),
	);
	const width = columns.length;
	const ordered = dependencyOrder(formulas);
	const codes = new Set(ordered.map((f) => f.code.trim()));
	const readCount = new Map<string, number>();
	for (const f of ordered) {
		for (const name of readsOf(f, codes)) readCount.set(name, (readCount.get(name) ?? 0) + 1);
	}

	// --- Inputs ---
	const given = new Map([...(run?.visit ?? []), ...(run?.fixed ?? [])].map((r) => [r.key, r]));
	const taken = new Set<string>();
	const inputRowsFor = (name: string, band: SheetBand, detail: string, unused: boolean) => {
		const source = given.get(name);
		if (source) taken.add(name);
		const cells = emptyCells(width);
		source?.cells.forEach((cell, index) => {
			if (index < cells.length) cells[index] = cell;
		});
		return {
			key: name,
			band,
			label: name,
			units: null,
			note: source?.note ?? detail,
			code: null,
			unused,
			cells,
		} satisfies SheetRow;
	};

	const inputRows: SheetRow[] = [];
	for (const input of inputs) {
		const band = BAND_OF_KIND[input.kind];
		if (!band) continue;
		inputRows.push(inputRowsFor(input.name, band, input.detail, input.readBy.length === 0));
	}
	const named = new Set(inputRows.map((r) => r.key));
	for (const entry of declared) {
		if (named.has(entry.name)) continue;
		inputRows.push(
			inputRowsFor(entry.name, BAND_OF_KIND[entry.kind] ?? 'fixed', entry.detail, true),
		);
	}
	// A number the run was given that no formula names as a variable: a curve's coefficients are
	// read through `curve_slope` and `curve_intercept`, so the slot's own values appear only here.
	for (const row of run?.fixed ?? []) {
		if (taken.has(row.key)) continue;
		inputRows.push({
			key: row.key,
			band: 'fixed',
			label: row.label,
			units: row.units,
			note: row.note ?? null,
			code: null,
			unused: false,
			cells: [...row.cells, ...emptyCells(width)].slice(0, Math.max(1, width)),
		});
	}

	// --- Steps and outputs ---
	const computed = new Map(
		[...(tables?.steps ?? []), ...(tables?.outputs ?? [])].map((r) => [r.key, r]),
	);
	const computedRow = (f: EditableFormula, band: SheetBand): SheetRow => {
		const code = f.code.trim();
		const source = code ? computed.get(code) : undefined;
		const cells = emptyCells(width);
		source?.cells.forEach((cell, index) => {
			if (index < cells.length) cells[index] = cell;
		});
		return {
			key: rowKey(f),
			band,
			label: f.name.trim() || code,
			units: f.units.trim() || null,
			note: f.formula,
			code: code || null,
			unused: band === 'step' && !readCount.has(code),
			cells,
		};
	};

	const steps = ordered.filter((f) => f.intermediate).map((f) => computedRow(f, 'step'));
	const outputs = ordered
		.filter((f) => !f.intermediate)
		.map((f) => computedRow(f, readCount.has(f.code.trim()) ? 'read' : 'final'));
	const statistics = (tables?.statistics ?? []).map((row): SheetRow => ({
		key: row.key,
		band: 'statistics',
		label: row.label,
		units: row.units,
		note: row.note ?? null,
		code: null,
		unused: false,
		aggregateOf: row.aggregateOf ?? null,
		cells: [...row.cells, ...emptyCells(width)].slice(0, Math.max(1, width)),
	}));

	return [
		{ key: 'inputs', title: 'Inputs', columns, rows: inputRows },
		{ key: 'steps', title: 'Steps', columns, rows: steps },
		{
			key: 'outputs',
			title: 'Outputs',
			columns,
			rows: [...outputs, ...statistics],
		},
	];
}

/**
 * The row a formula is drawn as. A formula with no code yet has no name to be read by, so it is
 * keyed on its place in the set until the author gives it one.
 */
export function rowKey(formula: Pick<EditableFormula, 'code' | 'ordinal'>): string {
	return formula.code.trim() || `new-${formula.ordinal}`;
}

/** What a typed cell means. A cell the set computes is not typed into, and yields nothing. */
export type SheetEdit =
	| { kind: 'replicate'; name: string; index: number; text: string }
	| { kind: 'scalar'; name: string; text: string }
	| { kind: 'code'; key: string; text: string };

/**
 * What typing `text` at a cell of `row` changes: the label column renames a formula, a value
 * column supplies a number in place of what the visit or the catalog holds. Column 0 is the
 * label, so replicate A is column 1.
 */
export function cellEdit(row: SheetRow, column: number, text: string): SheetEdit | null {
	const computes = row.band === 'step' || row.band === 'read' || row.band === 'final';
	if (column === 0) return computes ? { kind: 'code', key: row.key, text } : null;
	if (computes || row.band === 'statistics') return null;
	if (row.band === 'replicated')
		return { kind: 'replicate', name: row.key, index: column - 1, text };
	return column === 1 ? { kind: 'scalar', name: row.key, text } : null;
}

/**
 * `text` written at one position of a typed replicate list, which the run parses back with
 * `parseReplicates`. A position past the end is filled in, so B can be typed before A.
 */
export function withReplicate(list: string, index: number, text: string): string {
	const parts = list.trim() === '' ? [] : list.split(/[,;]/).map((p) => p.trim());
	while (parts.length <= index) parts.push('');
	parts[index] = text.trim();
	while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
	return parts.join(', ');
}

/** What a palette entry dropped on a cell does. */
export type SheetDrop = { kind: 'input' } | { kind: 'identifier'; key: string } | null;

/**
 * A drop on the inputs block brings the entry in as a row of its own; a drop on a row the set
 * computes writes the entry into that formula. A statistic is neither.
 */
export function dropOn(block: SheetBlockKey, row: SheetRow | null): SheetDrop {
	if (block === 'inputs') return { kind: 'input' };
	if (row?.code) return { kind: 'identifier', key: row.key };
	return null;
}

const WORD = /[A-Za-z0-9_.]/;

/**
 * `name` written into `formula` at the caret, with a space where it would otherwise run into the
 * text beside it. A null caret appends. The returned caret sits after the name.
 */
export function insertIdentifier(
	formula: string,
	name: string,
	caret: number | null = null,
): { formula: string; caret: number } {
	const at = caret === null ? formula.length : Math.max(0, Math.min(caret, formula.length));
	const before = formula.slice(0, at);
	const after = formula.slice(at);
	const lead = before.length > 0 && WORD.test(before[before.length - 1]!) ? ' ' : '';
	const trail = after.length > 0 && WORD.test(after[0]!) ? ' ' : '';
	const inserted = `${lead}${name}${trail}`;
	return {
		formula: `${before}${inserted}${after}`,
		caret: at + lead.length + name.length,
	};
}

/** One value a formula read to produce a cell. */
export interface Contributor {
	name: string;
	value: number | null;
}

/**
 * What one cell was computed from: the variables the formula read and the value each was bound to,
 * in the order the formula names them. A cell that never ran contributes nothing.
 */
export function contributors(
	trace: RunTraceStep[],
	code: string,
	index: number | null = null,
): Contributor[] {
	const wanted = code.trim().toLowerCase();
	const step = trace.find((s) => s.code.toLowerCase() === wanted);
	if (!step) return [];
	const cell = step.per_replicate
		? index === null
			? step.cells[0]
			: step.cells.find((c) => c.index === index)
		: step.cells[0];
	if (!cell || cell.skipped) return [];
	const bindings = cell.bindings ?? {};
	const named = identifiers(step.formula)
		.map(({ name }) => name)
		.filter((name, i, all) => all.indexOf(name) === i && name in bindings);
	const rest = Object.keys(bindings).filter((name) => !named.includes(name));
	return [...named, ...rest].map((name) => ({
		name,
		value: bindings[name] ?? null,
	}));
}

/** The cell a reader is on: the block it sits in, its row and its column. */
export interface SheetSelection {
	block: SheetBlockKey;
	key: string;
	/** 0 is the label column; 1 is the first replicate. */
	column: number;
}
