import type { Constant, DerivedParameter, Parameter } from '$api/crud';
import type { FormulaDraft, FormulaDraftRunRequest, ToolOutput } from '$api/service';
import { CURVE_VARIABLES, FORMULA_CONSTANTS, FORMULA_FUNCTIONS, identifiers } from '$lib/formula/lint';

// A calculation as one page holds it: the formulas in order, what they read, what they publish,
// and the request that runs them as they stand.

/** One formula as the editor holds it: a stored row, or one not saved yet (no `id`). */
export interface EditableFormula extends FormulaDraft {
	id: string | null;
	name: string;
	units: string;
	curve_slot: string;
	per_replicate: string;
	intermediate: boolean;
	/**
	 * The declaration this calculation reads the step through, when the step belongs to no
	 * calculation. Null on a formula of this calculation's own.
	 */
	declarationId?: string | null;
}

export function editableFormula(stored: DerivedParameter): EditableFormula {
	return {
		id: stored.id,
		code: stored.code,
		name: stored.name ?? '',
		units: stored.units ?? '',
		formula: stored.formula,
		ordinal: stored.ordinal,
		curve_slot: stored.curve_slot ?? '',
		per_replicate: stored.per_replicate ?? '',
		intermediate: stored.intermediate ?? false,
	};
}

/** A blank formula placed after the last one. */
export function blankFormula(existing: EditableFormula[]): EditableFormula {
	const last = existing.reduce((max, f) => Math.max(max, f.ordinal), 0);
	return {
		id: null,
		code: '',
		name: '',
		units: '',
		formula: '',
		ordinal: last + 1,
		curve_slot: '',
		per_replicate: '',
		intermediate: false,
	};
}

/** The tie-break between two formulas neither of which reads the other: ordinal, then code. */
export function inOrder<T extends { ordinal: number; code: string }>(formulas: T[]): T[] {
	return [...formulas].sort((a, b) => a.ordinal - b.ordinal || a.code.localeCompare(b.code));
}

/**
 * The formulas in the order the dependencies give them: a formula comes after every formula whose
 * code it reads, and two that read nothing of each other keep the tie-break above. This is what
 * the server evaluates them in, so the page shows that rather than a hand-set order.
 *
 * A cycle is refused by the server; here its members are appended in the tie-break order, so the
 * list still shows every formula while the page is being written.
 */
export function dependencyOrder<T extends { ordinal: number; code: string; formula: string }>(
	formulas: T[],
): T[] {
	const candidates = inOrder(formulas);
	const codes = new Map<string, T>();
	for (const f of candidates) {
		const code = f.code.trim();
		if (code && !codes.has(code)) codes.set(code, f);
	}
	const reads = (f: T) =>
		identifiers(f.formula)
			.map(({ name }) => name)
			.filter((name) => name !== f.code.trim() && codes.has(name));

	const ordered: T[] = [];
	const placed = new Set<string>();
	let remaining = [...candidates];
	while (remaining.length > 0) {
		const ready = remaining.filter((f) => reads(f).every((name) => placed.has(name)));
		if (ready.length === 0) break;
		for (const f of ready) {
			ordered.push(f);
			const code = f.code.trim();
			if (code) placed.add(code);
		}
		remaining = remaining.filter((f) => !ready.includes(f));
	}
	return [...ordered, ...remaining];
}

/** The body a formula's create or update carries. */
export function formulaBody(formula: EditableFormula, calculationId: string) {
	return {
		code: formula.code.trim(),
		name: formula.name.trim() || formula.code.trim(),
		units: formula.units.trim(),
		formula: formula.formula,
		tool_script_id: calculationId,
		ordinal: formula.ordinal,
		per_replicate: formula.per_replicate.trim() || null,
		curve_slot: formula.curve_slot.trim() || null,
		intermediate: formula.intermediate,
	};
}

export type InputKind = 'replicates' | 'parameter' | 'constant' | 'step' | 'curve' | 'other';

/** One thing the formula set reads, and how the run supplies it. */
export interface InputRow {
	name: string;
	kind: InputKind;
	/** The catalog label, or the constant's value. */
	detail: string;
	/** The formulas naming it, by code. */
	readBy: string[];
}

const LANGUAGE = new Set<string>([...Object.keys(FORMULA_FUNCTIONS), ...FORMULA_CONSTANTS]);

/**
 * Everything the formula set reads, classified: a family the run takes as a list, a catalog
 * parameter read from the visit, a constant, an earlier formula's value, a curve coefficient, or
 * a name the server resolves as a site property (or refuses).
 */
export function inputRows(
	formulas: Array<Pick<EditableFormula, 'code' | 'formula' | 'per_replicate' | 'curve_slot'>>,
	parameters: Parameter[],
	constants: Constant[],
): InputRow[] {
	const codes = new Set(formulas.map((f) => f.code.trim()).filter(Boolean));
	const families = new Set(formulas.map((f) => f.per_replicate.trim()).filter(Boolean));
	const byCode = new Map(parameters.map((p) => [p.code, p]));
	const constantByName = new Map(constants.map((c) => [c.name, c]));
	const rows = new Map<string, InputRow>();
	for (const f of formulas) {
		const own = f.code.trim();
		for (const { name } of identifiers(f.formula)) {
			if (LANGUAGE.has(name) || name === own) continue;
			const row = rows.get(name);
			if (row) {
				if (!row.readBy.includes(own)) row.readBy.push(own);
				continue;
			}
			let kind: InputKind = 'other';
			let detail = 'resolved by the server as a site property';
			if (codes.has(name)) {
				kind = 'step';
				detail = 'an earlier formula';
			} else if ((CURVE_VARIABLES as readonly string[]).includes(name)) {
				kind = 'curve';
				detail = f.curve_slot.trim() ? `slot ${f.curve_slot.trim()}` : 'no curve slot declared';
			} else if (constantByName.has(name)) {
				kind = 'constant';
				const c = constantByName.get(name)!;
				detail = c.units ? `${c.value} ${c.units}` : String(c.value);
			} else if (byCode.has(name)) {
				const p = byCode.get(name)!;
				kind = families.has(name) ? 'replicates' : 'parameter';
				detail = p.default_units ? `${p.name} (${p.default_units})` : p.name;
			}
			rows.set(name, { name, kind, detail, readBy: own ? [own] : [] });
		}
	}
	return [...rows.values()];
}

/** What the calculation publishes: every formula that is not a step, in order. */
export function outputRows(formulas: EditableFormula[]) {
	return dependencyOrder(formulas)
		.filter((f) => !f.intermediate)
		.map((f) => ({
			code: f.code,
			label: f.name.trim() || f.code,
			units: f.units,
			perReplicate: f.per_replicate.trim().length > 0,
		}));
}

/**
 * A typed replicate list. Commas or semicolons separate entries and a blank or `-` entry is a
 * repeat not measured; a list with neither separator splits on whitespace.
 */
export function parseReplicates(text: string): Array<number | null> {
	const trimmed = text.trim();
	if (trimmed === '') return [];
	const parts = /[,;]/.test(trimmed) ? trimmed.split(/[,;]/) : trimmed.split(/\s+/);
	return parts.map((p) => {
		const entry = p.trim();
		if (entry === '' || entry === '-') return null;
		const n = Number(entry);
		return Number.isFinite(n) ? n : null;
	});
}

/** The request a run at a visit carries: the set as it stands, the visit, and each family's list. */
export function draftRunBody(
	formulas: EditableFormula[],
	visit: { siteId: string; collectedAt: string },
	replicates: Record<string, string>,
): FormulaDraftRunRequest {
	const inputs: Record<string, unknown> = { site_id: visit.siteId, collected_at: visit.collectedAt };
	for (const [name, text] of Object.entries(replicates)) {
		const values = parseReplicates(text);
		if (values.length > 0) inputs[name] = values;
	}
	return {
		formulas: dependencyOrder(formulas)
			.filter((f) => f.code.trim().length > 0)
			.map((f) => ({
				code: f.code.trim(),
				name: f.name.trim() || undefined,
				units: f.units.trim() || undefined,
				formula: f.formula,
				ordinal: f.ordinal,
				per_replicate: f.per_replicate.trim() || undefined,
				curve_slot: f.curve_slot.trim() || undefined,
				intermediate: f.intermediate,
			})),
		inputs,
	};
}

/** The draft manifest's outputs in the shape the run table reads. */
export function draftOutputs(manifest: unknown): ToolOutput[] {
	const outputs = (manifest as { outputs?: unknown[] } | null)?.outputs;
	if (!Array.isArray(outputs)) return [];
	return outputs.map((o) => ({ ...(o as object), parameter: null }) as ToolOutput);
}
