import type { InputRow } from './editor';
import { dependencyOrder, parseReplicates, type EditableFormula } from './editor';
import { identifiers } from '$lib/formula/lint';
import type { FixedSource, RunCell, RunInputTables, RunTables } from '$lib/tools/runTable';
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
	/** Holds one value per replicate: a replicated input, or a formula run per replicate. */
	replicated: boolean;
	/** A step this calculation reads through a declaration: its code is the owner's to change. */
	declared?: boolean;
	/** On a statistic, the output whose repeats it summarises. */
	aggregateOf?: string | null;
	/** On an input that is not typed at a visit, what supplies it. */
	tag?: FixedSource;
	/** On an input, every formula reads it through a guard, so a visit without it still runs. */
	optional?: boolean;
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

/** What the author typed into the input cells, as the page holds it: by input name. */
export interface TypedInputs {
	scalars: Record<string, string>;
	replicates: Record<string, string>;
}

/**
 * `cells` with what was typed for the input laid over them, each such cell marked: a family's list
 * across its replicates, a number in place of a parameter, constant or site property. A curve slot
 * takes nothing typed, and a blank or unreadable entry is not a value the run takes, so either
 * keeps what the run was given.
 */
function withTyped(input: InputRow, cells: RunCell[], typed?: TypedInputs): RunCell[] {
	if (!typed) return cells;
	const scalar = input.kind === 'parameter' || input.kind === 'constant' || input.kind === 'other';
	const text = scalar ? (typed.scalars[input.name] ?? '').trim() : '';
	const values =
		input.kind === 'replicates'
			? parseReplicates(typed.replicates[input.name] ?? '')
			: text === ''
				? []
				: [Number(text)];
	return cells.map((cell, index) => {
		const value = values[index];
		return value != null && Number.isFinite(value) ? { value, skipped: null, typed: true } : cell;
	});
}

const BAND_OF_KIND: Record<InputRow['kind'], SheetBand | null> = {
	replicates: 'replicated',
	parameter: 'single',
	constant: 'fixed',
	curve: 'fixed',
	other: 'fixed',
	step: null,
};

const TAG_OF_KIND: Partial<Record<InputRow['kind'], FixedSource>> = {
	constant: 'constant',
	curve: 'curve',
	other: 'site',
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

/**
 * What a formula reads of the set, and which of the set's formulas read a variable: a formula, or
 * an input a formula names or runs over as its replicate family.
 */
export function linksOf(
	formulas: Array<Pick<EditableFormula, 'code' | 'formula' | 'per_replicate'>>,
	code: string,
): { reads: string[]; readBy: string[] } {
	const codes = new Set(formulas.map((f) => f.code.trim()).filter(Boolean));
	const wanted = code.trim();
	const self = formulas.find((f) => f.code.trim() === wanted);
	const reads = (f: (typeof formulas)[number]) =>
		f.per_replicate.trim() === wanted || identifiers(f.formula).some((i) => i.name === wanted);
	return {
		reads: self ? readsOf(self, codes) : [],
		readBy: wanted
			? formulas
					.filter((f) => f.code.trim() !== wanted && reads(f))
					.map((f) => f.code.trim())
					.filter(Boolean)
			: [],
	};
}

/**
 * The blocks, from the set and from a run of it: inputs, steps and outputs, or inputs and outputs
 * when `showSteps` is off and the set holds no step.
 *
 * `run` is what the run was given and `tables` what it computed; without either the blocks still
 * carry a row per input, step and output, with empty cells. Every block is drawn against the same
 * replicate letters, so the tables line up side by side. `typed` is laid over what the run was
 * given, so a number the author typed stays in its cell across reruns and the series preview.
 */
export function sheetBlocks(
	formulas: EditableFormula[],
	inputs: InputRow[],
	declared: DeclaredInput[] = [],
	run?: RunInputTables,
	tables?: RunTables,
	showSteps = true,
	typed?: TypedInputs,
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
	const inputRowsFor = (
		name: string,
		kind: InputRow['kind'],
		band: SheetBand,
		detail: string,
		unused: boolean,
		input: InputRow | null = null,
	) => {
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
			replicated: band === 'replicated',
			...(TAG_OF_KIND[kind] ? { tag: TAG_OF_KIND[kind] } : {}),
			...(input?.optional && band !== 'fixed' ? { optional: true } : {}),
			cells: input ? withTyped(input, cells, typed) : cells,
		} satisfies SheetRow;
	};

	const inputRows: SheetRow[] = [];
	for (const input of inputs) {
		const band = BAND_OF_KIND[input.kind];
		if (!band) continue;
		inputRows.push(
			inputRowsFor(input.name, input.kind, band, input.detail, input.readBy.length === 0, input),
		);
	}
	const named = new Set(inputRows.map((r) => r.key));
	for (const entry of declared) {
		if (named.has(entry.name)) continue;
		inputRows.push(
			inputRowsFor(entry.name, entry.kind, BAND_OF_KIND[entry.kind] ?? 'fixed', entry.detail, true),
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
			replicated: false,
			...(row.source ? { tag: row.source } : {}),
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
			replicated: f.per_replicate.trim().length > 0,
			declared: f.declarationId != null,
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
		replicated: false,
		aggregateOf: row.aggregateOf ?? null,
		cells: [...row.cells, ...emptyCells(width)].slice(0, Math.max(1, width)),
	}));

	return [
		{ key: 'inputs', title: 'Inputs', columns, rows: inputRows },
		...(showSteps || steps.length > 0
			? [{ key: 'steps' as const, title: 'Steps', columns, rows: steps }]
			: []),
		{
			key: 'outputs',
			title: 'Outputs',
			columns,
			rows: [...outputs, ...statistics],
		},
	];
}

/**
 * Why the steps block cannot be turned off, or null when it can: a step is a formula of the set,
 * and hiding its block would hide the formula.
 */
export function stepsOffRefusal(formulas: Array<Pick<EditableFormula, 'code' | 'intermediate'>>): string | null {
	const steps = formulas.filter((f) => f.intermediate).map((f) => f.code.trim() || 'an unnamed step');
	if (steps.length === 0) return null;
	return `Steps stay on while the calculation has ${steps.length === 1 ? 'a step' : 'steps'}: ${steps.join(', ')}.`;
}

/**
 * The row a formula is drawn as. A formula with no code yet has no name to be read by, so it is
 * keyed on its place in the set until the author gives it one.
 */
export function rowKey(formula: Pick<EditableFormula, 'code' | 'ordinal'>): string {
	return formula.code.trim() || `new-${formula.ordinal}`;
}

/**
 * The formula a row computes, as its label cell shows it under the name. Null on an input, a
 * statistic and a formula not yet written.
 */
export function formulaOf(row: SheetRow): string | null {
	if (row.band !== 'step' && row.band !== 'read' && row.band !== 'final') return null;
	const text = row.note?.trim() ?? '';
	return text === '' ? null : text;
}

/** What the remove control on a row does, when the row has one. */
export type RowRemoval =
	| { kind: 'formula'; key: string; readers: string[] }
	| { kind: 'stop-reading'; key: string }
	| { kind: 'input'; name: string }
	| { kind: 'refused'; reason: string };

/**
 * What removing `row` does. A formula leaves the pending set, naming the formulas still reading
 * it; a shared step is no longer read here; an input brought in by hand leaves the inputs, and one
 * a formula still names is refused with the formulas naming it. A statistic, a curve coefficient
 * the run supplied and a step another calculation owns have no remove.
 */
export function rowRemoval(
	row: SheetRow,
	formulas: Array<
		Pick<EditableFormula, 'code' | 'formula' | 'per_replicate' | 'ordinal' | 'declarationId' | 'shared'>
	>,
	declared: string[],
): RowRemoval | null {
	if (row.band === 'statistics') return null;
	const formula = formulas.find((f) => rowKey(f) === row.key);
	if (formula) {
		if (formula.declarationId) return formula.shared ? { kind: 'stop-reading', key: row.key } : null;
		const code = formula.code.trim();
		return { kind: 'formula', key: row.key, readers: code ? linksOf(formulas, code).readBy : [] };
	}
	if (row.code) return null;
	const readers = formulas
		.filter((f) => identifiers(f.formula).some((i) => i.name === row.key))
		.map((f) => f.code.trim() || 'an unnamed formula');
	if (readers.length > 0) {
		return { kind: 'refused', reason: `${row.key} is read by ${readers.join(', ')}.` };
	}
	return declared.includes(row.key) ? { kind: 'input', name: row.key } : null;
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
	if (column === 0) return computes && !row.declared ? { kind: 'code', key: row.key, text } : null;
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
/**
 * What an empty block tells a reader. On an editable sheet each one names how a row arrives there,
 * which is the whole of the first gesture: the inputs take a drop, the steps and the outputs take
 * their own button. Read-only, each says only that it is empty.
 */
export function emptyBlockLine(block: SheetBlockKey, editable: boolean): string {
	if (block === 'inputs') {
		return editable
			? 'Drop a parameter or constant here, or write a formula that reads one.'
			: 'Nothing read yet.';
	}
	if (block === 'steps') {
		return editable ? 'No steps yet: Add step puts one here.' : 'No steps: every formula publishes.';
	}
	return editable ? 'Nothing published yet: Add output puts a formula here.' : 'Nothing published yet.';
}

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

/** A replicated row's statistics: the mean and the sample sd (n - 1) of its numbers. */
export interface ReplicateStatistics {
	mean: number | null;
	sd: number | null;
	n: number;
}

/**
 * The mean and sample sd of the replicates a row holds, as the `samples` trigger derives them from
 * the saved repeats: a replicate with no number is left out, and one number has no sd.
 */
export function replicateStatistics(cells: RunCell[]): ReplicateStatistics {
	const values = cells
		.map((c) => c.value)
		.filter((v): v is number => v !== null && Number.isFinite(v));
	const n = values.length;
	if (n === 0) return { mean: null, sd: null, n };
	const mean = values.reduce((sum, v) => sum + v, 0) / n;
	if (n < 2) return { mean, sd: null, n };
	const squares = values.reduce((sum, v) => sum + (v - mean) ** 2, 0);
	return { mean, sd: Math.sqrt(squares / (n - 1)), n };
}

/** The statistics a block over replicates shows ahead of its letters, the mean leading. */
export const STATISTIC_COLUMNS = ['avg', 'sd'] as const;

export type StatisticColumn = (typeof STATISTIC_COLUMNS)[number];

/** How many statistic columns sit between a block's labels and its replicate letters. */
function statisticWidth(block: Pick<SheetBlock, 'columns'>): number {
	return block.columns.length > 0 ? STATISTIC_COLUMNS.length : 0;
}

/** What a column of a block's grid holds: the label, a statistic, or a replicate (1 is A). */
export type GridColumnRole =
	| { kind: 'label' }
	| { kind: 'statistic'; statistic: StatisticColumn }
	| { kind: 'value'; column: number };

/** The role of a grid column: column 0 is the label, then the statistics, then the letters. */
export function gridColumnRole(
	block: Pick<SheetBlock, 'columns'>,
	gridColumn: number,
): GridColumnRole {
	if (gridColumn === 0) return { kind: 'label' };
	const width = statisticWidth(block);
	if (gridColumn <= width) {
		return { kind: 'statistic', statistic: STATISTIC_COLUMNS[gridColumn - 1]! };
	}
	return { kind: 'value', column: gridColumn - width };
}

/** The grid column a selection column (0 the label, 1 replicate A) is drawn at. */
export function gridColumnOf(block: Pick<SheetBlock, 'columns'>, column: number): number {
	return column === 0 ? 0 : column + statisticWidth(block);
}

/**
 * The column a connector line meets a row at. A row that is read sits left of its reader, so the
 * line leaves it from its last cell and meets the reader at its label.
 */
export function edgeColumn(end: 'source' | 'reader', columnCount: number): number {
	return end === 'source' ? Math.max(1, columnCount) : 0;
}
