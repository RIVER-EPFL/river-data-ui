import { SITE_PROPERTIES } from '$api/crud';
import type { Constant, DerivedParameter, Parameter } from '$api/crud';
import type { FormulaDraft, FormulaDraftRunRequest, FormulaSetSave, ToolOutput } from '$api/service';
import { toNum, type ThresholdForm, type ThresholdPatch } from '$lib/derivedParameters';
import { CURVE_VARIABLES, FORMULA_CONSTANTS, FORMULA_FUNCTIONS, identifiers } from '$lib/formula/lint';

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
	 * The bounds of the output parameter's own `alarm_thresholds` row, the row with no site. Blank
	 * on a step, which publishes nothing, and on an output nothing has bounded yet.
	 */
	thresholds: ThresholdForm;
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
		codeLocked: stored.code_locked ?? null,
	};
}

/**
 * A formula this calculation reads without owning: a step belonging to no calculation, which every
 * calculation that declares it reads under this code. The set save leaves it out; it is written on
 * its own and declared into the calculation.
 */
export function isSharedStep(f: EditableFormula): boolean {
	return f.declarationId != null || (f.shared && f.intermediate);
}

/**
 * The shared steps the save writes beside the set: one it has no declaration for yet. A formula
 * with an id is unowned in place and keeps its identity; one without is created unowned.
 */
export function sharedStepWrites(formulas: EditableFormula[]): EditableFormula[] {
	return formulas.filter((f) => isSharedStep(f) && !f.declarationId);
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
 * The set-level save's body: this calculation's own formulas, trimmed, and what happens to the
 * values the version being replaced produced. A shared step belongs to no calculation, so it is
 * left out and the save neither rewrites nor deletes it, whether it was already declared here or
 * the author has just marked it shared. A formula the author removed is left out too, which is how
 * the save deletes it.
 */
export function formulaSetBody(formulas: EditableFormula[], migrate: boolean): FormulaSetSave {
	return {
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
		migrate_stored: migrate,
	};
}

/**
 * The formulas a preview can be asked for: a row with no code or no expression is still being
 * written, and the server refuses the whole set over it.
 */
export function previewable<T extends { code: string; formula: string }>(formulas: T[]): T[] {
	return formulas.filter((f) => f.code.trim() !== '' && f.formula.trim() !== '');
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
				kind = isFamily(name) ? 'replicates' : 'parameter';
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
 * coefficients rather than refused.
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

/**
 * Everything the builder offers and the lint accepts as a variable: the measurement catalog, and
 * the site's own columns, which a formula reads through the server's site sources (D13).
 */
export function formulaVariables(
	parameters: Parameter[]
): Array<{ name: string; label: string; category: string }> {
	return [
		...parameters
			.filter((p) => p.category !== 'device_health')
			.map((p) => ({
				name: p.code,
				label: `${p.name}${p.default_units ? ' (' + p.default_units + ')' : ''}`,
				category: p.category,
			})),
		...SITE_PROPERTIES.map((name) => ({ name, label: name, category: 'site property' })),
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
