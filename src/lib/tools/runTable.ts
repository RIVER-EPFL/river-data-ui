import type { RunTraceStep, ToolOutput } from '$api/service';

/// A run as the portal reads it: parameters down, replicates across.
///
/// The flat `{key: value}` map a run returns is one row per output *and* per replicate index, so a
/// six-formula calculation over two repeats reads as twelve unrelated numbers. The portal pivots
/// that into a table of outputs against replicate letters, with the steps of the calculation above
/// the values it publishes, and the mean and standard deviation in a table of their own.

/** One variable a formula read: its name, its value, and the row it came from when that row is
 *  a step of the same run. */
export interface CellBinding {
	name: string;
	value: number | null;
	step: string | null;
}

/** The equation behind a cell: the formula text and what it read. */
export interface CellTrace {
	formula: string;
	bindings: CellBinding[];
}

/** One cell: a value, a reason it never ran, or nothing at that index. */
export interface RunCell {
	value: number | null;
	skipped: string | null;
	trace?: CellTrace;
}

export interface RunRow {
	key: string;
	label: string;
	units: string | null;
	/** One cell per replicate column, in column order. */
	cells: RunCell[];
}

export interface RunTables {
	/** The replicate suffixes the run produced, in the order they appear ('A', 'B', …). Empty for
	 *  a calculation that ran once. */
	columns: string[];
	/** Steps of the calculation: computed, handed on, stored nowhere (M180). */
	steps: RunRow[];
	/** What the calculation publishes. */
	outputs: RunRow[];
	/** The mean and standard deviation of a replicated output, which the database derives from the
	 *  saved repeats and this only shows. */
	statistics: RunRow[];
}

interface Declared {
	output: ToolOutput;
	suffix: string | null;
}

/** The manifest declaration behind one result key, and the replicate suffix it carries. */
function declarationFor(outputs: ToolOutput[]): (key: string) => Declared | null {
	const exact = new Map<string, ToolOutput>();
	const replicated: { base: string; output: ToolOutput }[] = [];
	for (const o of outputs) {
		const base = o.key.replace(/_?\{rep\}/, '');
		if (o.per_replicate) replicated.push({ base, output: o });
		else exact.set(o.key, o);
	}
	return (key) => {
		const direct = exact.get(key);
		if (direct) return { output: direct, suffix: null };
		// The formula engine reports a per-replicate output under its bare key, as one list.
		const whole = replicated.find((r) => r.base === key);
		if (whole) return { output: whole.output, suffix: null };
		const rep = replicated.find((r) => key.startsWith(`${r.base}_`));
		return rep ? { output: rep.output, suffix: key.slice(rep.base.length + 1) } : null;
	};
}

/** The portal's replicate letters: index 0 is A. */
export function indexLetter(index: number): string {
	return String.fromCharCode(65 + (index % 26));
}

function asNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function cellTrace(step: RunTraceStep, index: number, stepCodes: Set<string>): CellTrace | null {
	const cell = step.per_replicate
		? step.cells.find((c) => c.index === index)
		: step.cells[0];
	if (!cell || cell.skipped) return null;
	return {
		formula: step.formula,
		bindings: Object.entries(cell.bindings).map(([name, value]) => ({
			name,
			value: asNumber(value),
			step: stepCodes.has(name) ? name : null,
		})),
	};
}

/**
 * Shape one run into the tables that render it.
 *
 * A key the manifest does not declare is a step of the calculation: an intermediate saves nowhere,
 * so the manifest carries no output for it, and the run reports it under its own code. A run that
 * carries its trace says so itself, and each cell then opens its formula with the values it read.
 */
export function runTables(
	results: Record<string, unknown>,
	outputs: ToolOutput[],
	skipped: Array<Record<string, unknown>> = [],
	trace: RunTraceStep[] = [],
): RunTables {
	const declaration = declarationFor(outputs);
	const traced = new Map(trace.map((t) => [t.code, t]));
	const stepCodes = new Set(trace.map((t) => t.code));
	const reasons = new Map<string, string>();
	for (const entry of skipped) {
		const key = typeof entry.output === 'string' ? entry.output : null;
		const reason = typeof entry.reason === 'string' ? entry.reason : 'did not run';
		if (key) reasons.set(key, reason);
	}

	// Columns are the suffixes actually produced, in first-seen order, so a calculation over three
	// repeats grows a column rather than needing to declare one. The formula engine returns a
	// per-replicate output as one list, index by index; its columns are the letters of those
	// positions.
	const columns: string[] = [];
	const keys = [...new Set([...Object.keys(results), ...reasons.keys()])];
	for (const key of keys) {
		const suffix = declaration(key)?.suffix;
		if (suffix && !columns.includes(suffix)) columns.push(suffix);
		const list = results[key];
		if (Array.isArray(list)) {
			for (const letter of list.map((_, i) => indexLetter(i))) {
				if (!columns.includes(letter)) columns.push(letter);
			}
		}
	}
	columns.sort((a, b) => a.localeCompare(b));

	const rows = new Map<string, RunRow>();
	const order: { key: string; band: 'step' | 'output' | 'statistic' }[] = [];
	const rowFor = (
		key: string,
		label: string,
		units: string | null,
		band: 'step' | 'output' | 'statistic',
	) => {
		let row = rows.get(key);
		if (!row) {
			row = {
				key,
				label,
				units,
				cells: columns.length > 0 ? columns.map(() => ({ value: null, skipped: null })) : [
					{ value: null, skipped: null },
				],
			};
			rows.set(key, row);
			order.push({ key, band });
		}
		return row;
	};

	for (const key of keys) {
		const declared = declaration(key);
		const step = traced.get(key);
		const band: 'step' | 'output' | 'statistic' = step
			? step.intermediate
				? 'step'
				: 'output'
			: !declared
				? 'step'
				: declared.output.aggregate_of
					? 'statistic'
					: 'output';
		const base = declared ? declared.output.key.replace(/_?\{rep\}/, '') : key;
		const row = rowFor(
			base,
			declared?.output.label ?? step?.label ?? key.replace(/_/g, ' '),
			declared?.output.units ?? step?.units ?? null,
			band,
		);
		const withTrace = (cell: RunCell, index: number): RunCell => {
			const t = step ? cellTrace(step, index, stepCodes) : null;
			return t ? { ...cell, trace: t } : cell;
		};
		const list = results[key];
		if (Array.isArray(list)) {
			list.forEach((value, index) => {
				const at = columns.indexOf(indexLetter(index));
				if (at >= 0 && at < row.cells.length) {
					row.cells[at] = withTrace({ value: asNumber(value), skipped: null }, index);
				}
			});
			continue;
		}
		const at = declared?.suffix ? columns.indexOf(declared.suffix) : 0;
		if (at >= 0 && at < row.cells.length) {
			row.cells[at] = withTrace(
				{ value: asNumber(results[key]), skipped: reasons.get(key) ?? null },
				0,
			);
		}
	}

	const band = (want: 'step' | 'output' | 'statistic') =>
		order.filter((o) => o.band === want).map((o) => rows.get(o.key)!);
	return { columns, steps: band('step'), outputs: band('output'), statistics: band('statistic') };
}
