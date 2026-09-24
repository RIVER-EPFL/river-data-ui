import { SITE_PROPERTIES } from '$api/crud';
import type { Constant, DerivedParameter, Parameter } from '$api/crud';
import type { FormulaDraft, FormulaDraftRunRequest, FormulaSetSave, ToolOutput } from '$api/service';
import { toNum, type ThresholdForm, type ThresholdPatch } from '$lib/derivedParameters';
import { CURVE_VARIABLES, FORMULA_CONSTANTS, FORMULA_FUNCTIONS, identifiers } from '$lib/formula/lint';
import { hasGap, parseFromMeval, unparsed } from '$components/formula/ast';
import { heldOf } from '$lib/calculations/heldInputs';

// A calculation as one page holds it: the formulas in order, what they read, what they publish,
// and the request that runs them as they stand.

/** One formula as the editor holds it: a stored row, or one not saved yet (no `id`). */
export interface EditableFormula extends FormulaDraft {
	id: string | null;
	name: string;
	units: string;
	/** What the formula transcribes, and from where: the provenance line, as the author wrote it. */
	description: string;
	curve_slot: string;
	per_replicate: string;
	intermediate: boolean;
	/**
	 * The declaration this calculation reads the step through, when the step belongs to no
	 * calculation. Null on a formula of this calculation's own.
	 */
	declarationId?: string | null;
	/**
	 * Whether the step belongs to no calculation, so every calculation that declares it reads its
	 * value. Set from `declarationId` on load, and by the author on a step the page still owns.
	 */
	shared: boolean;
	/**
	 * The declared step this calculation receives the step through (Q254): a shared step a declared
	 * one reads. Read-only here, and never written by the save, which would declare it.
	 */
	receivedThrough?: string | null;
	/**
	 * The bounds of the output parameter's own `alarm_thresholds` row, the row with no site. Blank
	 * on a step, which publishes nothing, and on an output nothing has bounded yet.
	 */
	thresholds: ThresholdForm;
	/**
	 * The variables this formula holds between visits rather than reading at the instant computed
	 * (Q230), as the stored sources declare them. Read-only here: the save writes the formulas,
	 * and the declaration is the source row's.
	 */
	held: string[];
	/**
	 * Why the code can no longer be changed, from the server. Null while it is still free: the
	 * catalog code is the CSV column header and the public API's identifier, so a rename is
	 * refused once readings are stored under the output parameter or a project publishes it.
	 */
	codeLocked: string | null;
}

export const blankThresholds = (): ThresholdForm => ({
	warningMin: '',
	warningMax: '',
	alarmMin: '',
	alarmMax: '',
});

export function editableFormula(stored: DerivedParameter): EditableFormula {
	return {
		id: stored.id,
		code: stored.code,
		name: stored.name ?? '',
		units: stored.units ?? '',
		description: stored.description ?? '',
		formula: stored.formula,
		ordinal: stored.ordinal,
		curve_slot: stored.curve_slot ?? '',
		per_replicate: stored.per_replicate ?? '',
		intermediate: stored.intermediate ?? false,
		shared: false,
		thresholds: blankThresholds(),
		held: heldOf(stored.sources),
		codeLocked: stored.code_locked ?? null,
	};
}

/**
 * A formula this calculation reads without owning: a step belonging to no calculation, which every
 * calculation that declares it reads under this code. The set save leaves it out; it is written on
 * its own and declared into the calculation. A declared step the author stops sharing is saved
 * into the set, which takes it back as this calculation's own.
 */
export function isSharedStep(f: EditableFormula): boolean {
	return f.shared && f.intermediate;
}

/** The fields of a step the calculation that declares it may correct. */
const STEP_FIELDS = [
	'code',
	'name',
	'units',
	'description',
	'formula',
	'per_replicate',
	'curve_slot',
] as const;

/**
 * The shared steps the save writes beside the set: one it has no declaration for yet, and one
 * declared here whose fields differ from the stored step. A formula with an id is written in place
 * and keeps its identity; one without is created unowned.
 */
export function sharedStepWrites(
	formulas: EditableFormula[],
	stored: EditableFormula[] = [],
): EditableFormula[] {
	return formulas.filter((f) => {
		if (!isSharedStep(f) || f.receivedThrough) return false;
		if (!f.declarationId) return true;
		const was = stored.find((s) => s.id === f.id);
		return !was || STEP_FIELDS.some((field) => was[field] !== f[field]);
	});
}

/**
 * The shared steps a calculation receives without declaring them: every shared step one of
 * `declared` reads, and the ones those read, each once, named by the declared step it is
 * reached through.
 */
export function receivedSteps(declared: EditableFormula[], steps: DerivedParameter[]): EditableFormula[] {
	const shared = new Map(
		steps.filter((s) => !s.tool_script_id && s.intermediate).map((s) => [s.code, s]),
	);
	const reached = new Set(declared.map((f) => f.code.trim()));
	const received: EditableFormula[] = [];
	const pending: Array<{ text: string; through: string }> = declared.map((f) => ({
		text: f.formula,
		through: f.code.trim(),
	}));
	while (pending.length > 0) {
		const { text, through } = pending.shift()!;
		for (const { name } of identifiers(text)) {
			const step = shared.get(name);
			if (!step || reached.has(name)) continue;
			reached.add(name);
			received.push({ ...editableFormula(step), shared: true, receivedThrough: through });
			pending.push({ text: step.formula, through });
		}
	}
	return received;
}

/** A blank formula placed after the last one. */
export function blankFormula(existing: EditableFormula[]): EditableFormula {
	const last = existing.reduce((max, f) => Math.max(max, f.ordinal), 0);
	return {
		id: null,
		code: '',
		name: '',
		units: '',
		description: '',
		formula: '',
		ordinal: last + 1,
		curve_slot: '',
		per_replicate: '',
		intermediate: false,
		shared: false,
		thresholds: blankThresholds(),
		held: [],
		codeLocked: null,
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

/**
 * The set-level save's body: this calculation's own formulas, trimmed. A shared step belongs to no calculation, so it is
 * left out of the set and the save neither rewrites nor deletes it; the steps the author marked
 * shared or corrected against `stored` travel beside it and are written in the same save. A formula
 * the author removed is left out too, which is how the save deletes it.
 */
export function formulaSetBody(
	formulas: EditableFormula[],
	stored: EditableFormula[] = [],
): FormulaSetSave {
	return {
		shared_steps: sharedStepWrites(formulas, stored).map((f) => ({
			id: f.id,
			code: f.code.trim(),
			name: f.name.trim() || f.code.trim(),
			units: f.units.trim(),
			description: f.description.trim() || null,
			formula: f.formula,
			per_replicate: f.per_replicate.trim() || null,
			curve_slot: f.curve_slot.trim() || null,
		})),
		formulas: formulas
			.filter((f) => !isSharedStep(f))
			.map((f) => ({
				id: f.id,
				code: f.code.trim(),
				name: f.name.trim() || f.code.trim(),
				units: f.units.trim(),
				description: f.description.trim() || null,
				formula: f.formula,
				ordinal: f.ordinal,
				per_replicate: f.per_replicate.trim() || null,
				curve_slot: f.curve_slot.trim() || null,
				intermediate: f.intermediate,
			})),
	};
}

const NAME = /^[A-Za-z_]\w*$/;

/**
 * `text` with every whole identifier `from` replaced by `to`. A token is a run of word characters,
 * as the server reads one, so the exponent of `2e5` is part of its number and never a name.
 */
function renameIdentifier(text: string, from: string, to: string): string {
	return text.replace(/\w+/g, (token) => (token === from ? to : token));
}

/**
 * Carry a formula's rename from `from` into every other formula of the set: a formula reads
 * another by its code, in its expression and in its per-replicate field, so each whole use of the
 * old code becomes the new one. A code that is not a name yet, or one another formula holds,
 * carries nothing: the rename is not finished.
 */
export function carryRename(formulas: EditableFormula[], renamed: EditableFormula, from: string): void {
	const to = renamed.code.trim();
	if (from === to || !NAME.test(to) || !NAME.test(from)) return;
	if (formulas.some((f) => f !== renamed && f.code.trim() === to)) return;
	for (const f of formulas) {
		if (f === renamed) continue;
		f.formula = renameIdentifier(f.formula, from, to);
		if (f.per_replicate.trim() === from) f.per_replicate = to;
	}
}

/**
 * The formulas a preview can be asked for: a row with no code or no expression is still being
 * written, and the server refuses the whole set over it.
 */
export function previewable<T extends { code: string; formula: string }>(formulas: T[]): T[] {
	return formulas.filter((f) => f.code.trim() !== '' && f.formula.trim() !== '');
}

/** A formula the chart leaves out, and the line the reader is given for it. */
export interface NotDrawn {
	code: string;
	reason: string;
}

/**
 * The formulas the chart asks the server for, and the ones it leaves out.
 *
 * The chart is a guide over what exists, and a half-written formula is the normal state while
 * authoring: a row the parser does not reach the end of is the cell's business, and a row naming
 * a parameter the site does not measure has no series to draw whatever the server says.
 */
export function drawable<T extends { code: string; formula: string }>(
	formulas: T[],
	site: { measured: string[]; constants: string[] } | null
): { draw: T[]; skipped: NotDrawn[] } {
	const draw: T[] = [];
	const skipped: NotDrawn[] = [];
	const codes = new Set(formulas.map((f) => f.code.trim()).filter(Boolean));
	const resolves = new Set([
		...(site?.measured ?? []),
		...(site?.constants ?? []),
		...LANGUAGE,
		...SITE_PROPERTIES,
		...CURVE_VARIABLES,
	]);
	for (const formula of previewable(formulas)) {
		const code = formula.code.trim();
		if (unparsed(formula.formula) !== '' || hasGap(parseFromMeval(formula.formula))) {
			skipped.push({ code, reason: 'still being written' });
			continue;
		}
		const missing = site
			? [
					...new Set(
						identifiers(formula.formula)
							.map((i) => i.name)
							.filter((name) => !resolves.has(name) && !codes.has(name))
					),
				]
			: [];
		if (missing.length > 0) {
			skipped.push({ code, reason: `the site does not measure ${missing.join(', ')}` });
			continue;
		}
		draw.push(formula);
	}
	return { draw, skipped };
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
	/** Every formula reads it only through a guard, so a visit without it still runs. */
	optional: boolean;
}

const LANGUAGE = new Set<string>([...Object.keys(FORMULA_FUNCTIONS), ...FORMULA_CONSTANTS]);

/** The functions a missing value may pass through, as the server's `NAN_TOLERANT_GUARDS`. */
const NAN_TOLERANT_GUARDS = new Set([
	'if',
	'and',
	'or',
	'not',
	'lt',
	'le',
	'gt',
	'ge',
	'eq',
	'ne',
	'coalesce',
	'is_missing',
]);

/**
 * Whether every read of `variable` in `formula` sits inside the arguments of a guard function, as
 * the server's `read_only_through_guards` decides it: a visit without the value binds it as NaN
 * and the formula still runs, where any other read skips the formula.
 */
export function readOnlyThroughGuards(formula: string, variable: string): boolean {
	const guarded: boolean[] = [];
	let pending: string | null = null;
	let read = false;
	let i = 0;
	while (i < formula.length) {
		const c = formula[i]!;
		if (/[\p{L}\p{N}_]/u.test(c)) {
			const start = i;
			while (i < formula.length && /[\p{L}\p{N}_]/u.test(formula[i]!)) i++;
			pending = formula.slice(start, i);
			continue;
		}
		if (c === '(') {
			// The identifier before a parenthesis names the call, not a value read.
			const call = pending;
			pending = null;
			guarded.push((guarded.at(-1) ?? false) || (call !== null && NAN_TOLERANT_GUARDS.has(call)));
		} else {
			if (pending === variable) {
				if (!(guarded.at(-1) ?? false)) return false;
				read = true;
			}
			pending = null;
			if (c === ')') guarded.pop();
		}
		i++;
	}
	if (pending === variable) return false;
	return read;
}

/** A formula whose field has focus, with its text as it stood when the field took focus. */
export interface FocusedFormula<F> {
	formula: F;
	text: string;
}

/**
 * The set with the formula being typed held at its text from when its field took focus, so a
 * half-typed name reaches the inputs only once the field is left.
 */
export function untilLeft<F extends Pick<EditableFormula, 'formula'>>(
	formulas: F[],
	focused: FocusedFormula<F> | null,
): F[] {
	if (!focused) return formulas;
	return formulas.map((f) => (f === focused.formula ? { ...f, formula: focused.text } : f));
}

/**
 * Everything the formula set reads, classified: a family the run takes as a list, a catalog
 * parameter read from the visit, a constant, an earlier formula's value, a curve coefficient, or
 * a name the server resolves as a site property (or refuses).
 *
 * `replicated` names the catalog codes the calculation's parameter group holds several values of
 * per visit. A source of one of those, read by a formula that walks the replicates, is the family
 * at the same letter rather than a number; one only ever read by a scalar formula stays a number
 * and resolves to the group's served value, which is its mean (Q155). This mirrors the manifest
 * the server builds.
 */
export function inputRows(
	formulas: Array<Pick<EditableFormula, 'code' | 'formula' | 'per_replicate' | 'curve_slot'>>,
	parameters: Parameter[],
	constants: Constant[],
	replicated: string[] = [],
): InputRow[] {
	const codes = new Set(formulas.map((f) => f.code.trim()).filter(Boolean));
	const families = new Set(formulas.map((f) => f.per_replicate.trim()).filter(Boolean));
	const declared = new Set(replicated.map((c) => c.toLowerCase()));
	const walked = new Set(
		formulas
			.filter((f) => f.per_replicate.trim())
			.flatMap((f) => identifiers(f.formula).map((i) => i.name)),
	);
	const isFamily = (name: string) =>
		families.has(name) || (walked.has(name) && declared.has(name.toLowerCase()));
	const byCode = new Map(parameters.map((p) => [p.code, p]));
	const constantByName = new Map(constants.map((c) => [c.name, c]));
	const rows = new Map<string, InputRow>();
	for (const f of formulas) {
		const own = f.code.trim();
		for (const { name } of identifiers(f.formula)) {
			if (LANGUAGE.has(name) || name === own) continue;
			const guarded = readOnlyThroughGuards(f.formula, name);
			const row = rows.get(name);
			if (row) {
				if (!row.readBy.includes(own)) row.readBy.push(own);
				row.optional &&= guarded;
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
				kind = isFamily(name) ? 'replicates' : 'parameter';
				detail = p.default_units ? `${p.name} (${p.default_units})` : p.name;
			}
			rows.set(name, { name, kind, detail, readBy: own ? [own] : [], optional: guarded });
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

/** The rows a run can be handed a number for: everything but a family, a step and a curve slot. */
export function scalarInputs(rows: InputRow[]): InputRow[] {
	return rows.filter((r) => r.kind === 'parameter' || r.kind === 'constant' || r.kind === 'other');
}

/** Typed values a run carries in place of what it would otherwise read. */
export interface ScalarOverrides {
	/** Manifest params: a catalog parameter read from the visit, or a site property. */
	inputs: Record<string, number>;
	/** Catalog constants, supplied in the catalog's place. */
	constants: Record<string, number>;
}

/**
 * Split the typed boxes by where the run body carries them: a constant goes in `constants`, a
 * parameter or a site property is a manifest param. A blank box is no override, and the run reads
 * the visit and the catalog as before.
 */
export function scalarOverrides(rows: InputRow[], text: Record<string, string>): ScalarOverrides {
	const overrides: ScalarOverrides = { inputs: {}, constants: {} };
	for (const row of scalarInputs(rows)) {
		const entry = (text[row.name] ?? '').trim();
		if (entry === '') continue;
		const value = Number(entry);
		if (!Number.isFinite(value)) continue;
		if (row.kind === 'constant') overrides.constants[row.name] = value;
		else overrides.inputs[row.name] = value;
	}
	return overrides;
}

/** The curve slots the set declares, in the order the formulas name them. */
export function curveSlots(formulas: Array<Pick<EditableFormula, 'curve_slot'>>): string[] {
	const slots: string[] = [];
	for (const f of formulas) {
		const slot = f.curve_slot.trim();
		if (slot && !slots.includes(slot)) slots.push(slot);
	}
	return slots;
}

/**
 * The request a run carries: the set as it stands, the visit if one is chosen, each family's list, the
 * curve each declared slot is bound to, and any value typed in place of what the visit or the
 * catalog holds. A slot left unbound is sent nothing, and its formulas are skipped for want of
 * coefficients rather than refused. A row still missing its code or its formula is being typed and
 * is not sent, since the server refuses the whole set over it.
 */
export function draftRunBody(
	formulas: EditableFormula[],
	visit: { siteId: string; collectedAt: string } | null,
	replicates: Record<string, string>,
	curves: Record<string, Record<string, unknown> | null> = {},
	overrides: ScalarOverrides = { inputs: {}, constants: {} },
): FormulaDraftRunRequest {
	// With no visit the run resolves nothing from storage and reads only what was typed.
	const inputs: Record<string, unknown> = visit
		? { site_id: visit.siteId, collected_at: visit.collectedAt }
		: {};
	for (const [name, text] of Object.entries(replicates)) {
		const values = parseReplicates(text);
		if (values.length > 0) inputs[name] = values;
	}
	for (const slot of curveSlots(formulas)) {
		const field = curves[slot];
		if (field) inputs[slot] = field;
	}
	Object.assign(inputs, overrides.inputs);
	const constants = Object.keys(overrides.constants).length > 0 ? overrides.constants : undefined;
	return {
		constants,
		formulas: dependencyOrder(formulas)
			.filter((f) => f.code.trim().length > 0 && f.formula.trim().length > 0)
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

/** A name the builder offers; `replicated` when a visit enters it several times. */
export interface FormulaVariable {
	name: string;
	label: string;
	category: string;
	replicated: boolean;
}

/**
 * Everything the builder offers and the lint accepts as a variable: the measurement catalog, and
 * the site's own columns, which a formula reads through the server's site sources (D13).
 * `replicated` is the codes a parameter group enters per replicate.
 */
export function formulaVariables(
	parameters: Parameter[],
	replicated: string[] = [],
): FormulaVariable[] {
	const perReplicate = new Set(replicated.map((c) => c.toLowerCase()));
	return [
		...parameters
			.filter((p) => p.category !== 'device_health')
			.map((p) => ({
				name: p.code,
				label: `${p.name}${p.default_units ? ' (' + p.default_units + ')' : ''}`,
				category: p.category,
				replicated: perReplicate.has(p.code.toLowerCase()),
			})),
		...SITE_PROPERTIES.map((name) => ({
			name,
			label: name,
			category: 'site property',
			replicated: false,
		})),
	];
}


/** One output parameter's bounds, as the save writes them. */
export interface ThresholdWrite {
	parameterId: string;
	patch: ThresholdPatch;
}

const sameBounds = (a: ThresholdForm, b: ThresholdForm): boolean =>
	(['warningMin', 'warningMax', 'alarmMin', 'alarmMax'] as const).every(
		(k) => toNum(a[k]) === toNum(b[k]),
	);

/**
 * The bounds the save writes onto each output's own threshold row: the outputs whose four fields
 * the author changed, paired with the parameter the saved set gives them. A step publishes nothing
 * and is left out, as is an output the set has not minted a parameter for. A field cleared is a
 * bound cleared, so the patch carries every field rather than only the ones with a number in.
 */
export function thresholdWrites(
	edited: EditableFormula[],
	stored: EditableFormula[],
	saved: Array<{ code: string; output_parameter_id: string | null }>,
): ThresholdWrite[] {
	const was = new Map(stored.map((f) => [f.code.trim(), f.thresholds]));
	const parameterOf = new Map(
		saved.filter((f) => f.output_parameter_id).map((f) => [f.code.trim(), f.output_parameter_id!]),
	);
	const writes: ThresholdWrite[] = [];
	for (const f of edited) {
		const code = f.code.trim();
		if (isSharedStep(f) || f.intermediate || !code) continue;
		if (sameBounds(f.thresholds, was.get(code) ?? blankThresholds())) continue;
		const parameterId = parameterOf.get(code);
		if (!parameterId) continue;
		writes.push({
			parameterId,
			patch: {
				warning_min: toNum(f.thresholds.warningMin),
				warning_max: toNum(f.thresholds.warningMax),
				alarm_min: toNum(f.thresholds.alarmMin),
				alarm_max: toNum(f.thresholds.alarmMax),
			},
		});
	}
	return writes;
}


/** The set's own outputs and steps as run-table declarations, for a run carrying no manifest. */
export function setOutputs(formulas: EditableFormula[]): ToolOutput[] {
	return inOrder(formulas)
		.filter((f) => f.code.trim())
		.map(
			(f) =>
				({
					key: f.code.trim(),
					label: f.name.trim() || f.code.trim(),
					units: f.units.trim() || null,
					per_replicate: false,
					aggregate_of: null,
					intermediate: f.intermediate,
					parameter: null,
				}) as unknown as ToolOutput,
		);
}

/**
 * Why the set cannot be read as a series on a site's streams, or null when it can. A curve slot's
 * coefficients are chosen per sample and a replicate is entered at a visit, so a set naming either
 * runs at field visits and nowhere else. The reason names what keeps it off streams.
 */
export function seriesBlocker(formulas: EditableFormula[]): string | null {
	const slot = curveSlots(formulas)[0];
	if (slot) return `the curve slot ${slot}, whose coefficients are chosen per sample`;
	const perReplicate = formulas.find((f) => f.per_replicate.trim());
	if (perReplicate)
		return `${perReplicate.code.trim() || 'a formula'}, which runs per replicate of ${perReplicate.per_replicate.trim()}`;
	return null;
}
