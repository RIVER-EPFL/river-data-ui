import type { RunTraceStep } from '$api/service';

/// The arithmetic behind one computed value, read out of a run's trace.
///
/// A trace is a flat list of formulas in evaluation order. A reader arrives at it holding one
/// number, so the chain starts at the step that produced it and follows the steps its variables
/// came from, down to the values the run was given.

/** One variable a formula read: its name, its value, and the step it came from when it came from
 *  one. */
export interface EquationBinding {
	name: string;
	value: number | null;
	step: string | null;
}

/** One formula as it was evaluated. `key` is unique within a chain, so a step reached twice at
 *  different indexes stays two entries. */
export interface EquationStep {
	key: string;
	code: string;
	label: string;
	units: string | null;
	formula: string;
	value: number | null;
	bindings: EquationBinding[];
}

function asNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The step a code names: its own code, or the catalog parameter it writes. */
function stepFor(steps: RunTraceStep[], code: string): RunTraceStep | undefined {
	const wanted = code.toLowerCase();
	return (
		steps.find((s) => s.code.toLowerCase() === wanted) ??
		steps.find((s) => s.output_parameter_code?.toLowerCase() === wanted)
	);
}

function cellOf(step: RunTraceStep, index: number | null) {
	if (!step.per_replicate) return step.cells[0];
	return index === null ? step.cells[0] : step.cells.find((c) => c.index === index);
}

/**
 * The focused step, and with `walk` the steps its variables came from, in the order a reader
 * follows them.
 *
 * A step is visited once per index it is reached at, and a variable bound to no step is a value
 * the run was given, so the walk terminates at the inputs.
 */
export function equationChain(
	steps: RunTraceStep[],
	code: string,
	index: number | null = null,
	walk = false,
): EquationStep[] {
	const codes = new Set(steps.map((s) => s.code.toLowerCase()));
	const chain: EquationStep[] = [];
	const seen = new Set<string>();
	const queue: { code: string; index: number | null }[] = [{ code, index }];

	while (queue.length > 0) {
		const want = queue.shift()!;
		const step = stepFor(steps, want.code);
		if (!step) continue;
		const cell = cellOf(step, want.index);
		if (!cell || cell.skipped) continue;
		const key = `${step.code}:${cell.index ?? ''}`;
		if (seen.has(key)) continue;
		seen.add(key);

		const bindings = Object.entries(cell.bindings ?? {}).map(([name, value]) => ({
			name,
			value: asNumber(value),
			step: codes.has(name.toLowerCase()) ? name : null,
		}));
		chain.push({
			key,
			code: step.code,
			label: step.label,
			units: step.units ?? null,
			formula: step.formula,
			value: asNumber(cell.value),
			bindings,
		});
		if (!walk) break;
		for (const b of bindings) {
			if (b.step) queue.push({ code: b.step, index: cell.index ?? null });
		}
	}
	return chain;
}

/** What a replayed run records about where its values came from. */
export interface RunSources {
	collected_at?: string | null;
	event_inputs?: unknown[];
	site_inputs?: unknown[];
	constants?: Record<string, unknown>;
}

function entryFor(entries: unknown[] | undefined, name: string): Record<string, unknown> | null {
	const found = entries?.find(
		(e) => typeof e === 'object' && e !== null && (e as Record<string, unknown>).param === name,
	);
	return (found as Record<string, unknown> | undefined) ?? null;
}

/**
 * Where a variable the run was given came from, as one line: the visit's reading it was read
 * from, the site's property, the constants catalog, or the person who ran it.
 */
export function inputOrigin(
	sources: RunSources,
	formatTime: (iso: string) => string,
): (name: string) => string {
	return (name) => {
		const event = entryFor(sources.event_inputs, name);
		if (event) {
			const code = typeof event.parameter_code === 'string' ? event.parameter_code : name;
			return sources.collected_at ? `${code}, visit ${formatTime(sources.collected_at)}` : code;
		}
		const site = entryFor(sources.site_inputs, name);
		if (site && typeof site.property === 'string') return `site ${site.property}`;
		if (sources.constants && name in sources.constants) return 'constant';
		return 'entered';
	};
}
