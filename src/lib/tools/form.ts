// Turns a tool manifest into a render plan and turns the entered values back into a request
// body. Nothing here knows a tool name: a param is rendered by its kind and, when it is
// structured, by the shape resolved in `shapes.ts`.

import {
	isToolParamCondition,
	type ToolCurveSlot,
	type ToolParam,
	type ToolParamCondition,
} from '$api/service';
import type { CurveSelection } from '$components/tools/CurvePicker.svelte';
import {
	listCell,
	resolveStructShape,
	rowLabelFor,
	seriesGroupsFor,
	slotCell,
	type SeriesGroup,
	type StructShape,
} from './shapes';
import { replicateFamilies } from './replicates';

export const num = (s: string | undefined): number | null =>
	s !== undefined && s !== '' && Number.isFinite(Number(s)) ? Number(s) : null;

export function enumVariants(kind: string): string[] {
	return kind.startsWith('enum:') ? kind.slice(5).split('|') : [];
}

/**
 * What the renderer needs of a tool. A saved `ToolDescriptor` satisfies it, and so does a manifest
 * still being written in the editor, which is what lets one renderer serve both.
 */
export interface ToolFormSpec {
	name: string;
	params: ToolParam[];
	curves: ToolCurveSlot[];
}

export interface FormState {
	values: Record<string, string>;
	bools: Record<string, boolean>;
	arrays: Record<string, string[]>;
	structs: Record<string, Record<string, string>[]>;
	series: Record<string, Record<string, string>[]>;
	shapes: Record<string, StructShape>;
}

/** One base measurement of a `{base}_rep_{letter}` family, as a row of replicate cells. */
export interface MatrixRow {
	key: string;
	label: string;
	units: string | null;
	cells: (ToolParam | null)[];
}

export interface MatrixGroup {
	title: string;
	reps: string[];
	rows: MatrixRow[];
}

export type FormItem =
	| { type: 'scalar'; param: ToolParam }
	| { type: 'boolean'; param: ToolParam }
	| { type: 'array'; param: ToolParam }
	| { type: 'replicates'; param: ToolParam }
	| { type: 'struct'; param: ToolParam; shape: StructShape }
	| { type: 'series'; group: SeriesGroup; params: ToolParam[] }
	| { type: 'matrix'; group: MatrixGroup };

/**
 * Params named `{base}_rep_{letter}` are one measurement entered per replicate, so they read as
 * a grid rather than as one input per cell. The families come from `replicates.ts`, which the
 * authoring params table reads too, so the run form and the editor group the same params.
 */
function matrixGroups(params: ToolParam[]): MatrixGroup[] {
	const { families, letters } = replicateFamilies(params);
	if (families.length === 0) return [];
	const rows: MatrixRow[] = families.map((f) => ({
		key: f.base,
		label: f.label,
		units: f.units,
		cells: letters.map((letter) => f.byLetter.get(letter)?.param ?? null),
	}));
	return [{ title: 'Replicates', reps: letters, rows }];
}

function conditionHolds(
	cond: ToolParamCondition,
	inputs: Record<string, unknown>,
): boolean {
	const actual = inputs[cond.param];
	if (actual === undefined || actual === null) return false;
	if (cond.equals !== undefined) return actual === cond.equals;
	if (cond.any_of !== undefined) return cond.any_of.some((v) => v === actual);
	return false;
}

/**
 * Whether the param applies at all. A string `when` is an advisory note and gates nothing, which
 * is how the server reads it too.
 */
export function paramApplies(p: ToolParam, inputs: Record<string, unknown>): boolean {
	if (p.when === null || p.when === undefined) return true;
	if (!isToolParamCondition(p.when)) return true;
	return conditionHolds(p.when, inputs);
}

/** Whether a missing value is refused. Matches the server's requiredness rule exactly. */
export function paramRequired(p: ToolParam, inputs: Record<string, unknown>): boolean {
	if (!p.required) return false;
	if (p.when === null || p.when === undefined) return true;
	if (!isToolParamCondition(p.when)) return false;
	return conditionHolds(p.when, inputs);
}

export function advisoryNote(p: ToolParam): string | null {
	return typeof p.when === 'string' ? p.when : null;
}

/** The scalar values a `when` condition reads, typed as they will be sent. */
export function conditionInputs(tool: ToolFormSpec, state: FormState): Record<string, unknown> {
	const inputs: Record<string, unknown> = {};
	for (const p of tool.params) {
		if (p.kind === 'boolean') {
			inputs[p.name] = state.bools[p.name] ?? p.default ?? false;
			continue;
		}
		const raw = String(state.values[p.name] ?? '').trim();
		if (raw === '') {
			if (p.default !== null && p.default !== undefined) inputs[p.name] = p.default;
			continue;
		}
		if (p.kind === 'string' || enumVariants(p.kind).length > 0) inputs[p.name] = raw;
		else if (p.kind === 'number' || p.kind === 'integer') {
			const n = num(raw);
			if (n !== null) inputs[p.name] = n;
		}
	}
	return inputs;
}

export function buildPlan(tool: ToolFormSpec, state: FormState): FormItem[] {
	const inputs = conditionInputs(tool, state);
	const groups = seriesGroupsFor(tool.name);
	const matrices = matrixGroups(tool.params);
	const matrixOf = new Map<string, MatrixGroup>();
	for (const g of matrices) {
		for (const row of g.rows) {
			for (const cell of row.cells) if (cell) matrixOf.set(cell.name, g);
		}
	}
	const emitted = new Set<string>();
	const items: FormItem[] = [];
	for (const p of tool.params) {
		if (!paramApplies(p, inputs)) continue;
		const group = groups.find((g) => g.params.includes(p.name));
		if (group) {
			if (emitted.has(group.title)) continue;
			emitted.add(group.title);
			items.push({
				type: 'series',
				group,
				params: group.params.map((name) => tool.params.find((q) => q.name === name) ?? p),
			});
			continue;
		}
		const matrix = matrixOf.get(p.name);
		if (matrix) {
			if (emitted.has(matrix.title)) continue;
			emitted.add(matrix.title);
			items.push({ type: 'matrix', group: matrix });
			continue;
		}
		if (p.kind === 'replicates') items.push({ type: 'replicates', param: p });
		else if (p.kind === 'boolean') items.push({ type: 'boolean', param: p });
		else if (p.kind === 'array') items.push({ type: 'array', param: p });
		else if (p.kind === 'object' || p.kind === 'replicate_grid') {
			const shape = state.shapes[p.name];
			if (shape) items.push({ type: 'struct', param: p, shape });
		} else items.push({ type: 'scalar', param: p });
	}
	return items;
}

function blankRow(shape: StructShape): Record<string, string> {
	const row: Record<string, string> = {};
	if (shape.form === 'lists') {
		for (let i = 0; i < shape.slots; i++) row[listCell(i)] = '';
		return row;
	}
	for (const f of shape.fields) {
		if (f.slots) for (let i = 0; i < f.slots; i++) row[slotCell(f.name, i)] = '';
		else row[f.name] = '';
	}
	for (const e of shape.entry) row[e.name] = '';
	return row;
}

export function emptyStructRows(shape: StructShape): Record<string, string>[] {
	const count = shape.form === 'lists' ? shape.fields.length : Math.max(1, shape.rows);
	return Array.from({ length: count }, () => blankRow(shape));
}

const asText = (v: unknown): string => (typeof v === 'number' ? String(v) : '');

function restoreStructRows(
	shape: StructShape,
	value: unknown,
): Record<string, string>[] | null {
	if (value === undefined || value === null) return null;
	if (shape.form === 'lists') {
		if (typeof value !== 'object') return null;
		const map = value as Record<string, unknown>;
		return shape.fields.map((f) => {
			const list = Array.isArray(map[f.name]) ? (map[f.name] as unknown[]) : [];
			const row = blankRow(shape);
			for (let i = 0; i < shape.slots; i++) row[listCell(i)] = asText(list[i]);
			return row;
		});
	}
	const objects: unknown[] =
		shape.form === 'object' ? [value] : Array.isArray(value) ? value : [];
	if (objects.length === 0) return null;
	return objects.map((entry) => {
		const obj = (entry ?? {}) as Record<string, unknown>;
		const row = blankRow(shape);
		for (const f of shape.fields) {
			if (f.slots) {
				const list = Array.isArray(obj[f.name]) ? (obj[f.name] as unknown[]) : [];
				for (let i = 0; i < f.slots; i++) row[slotCell(f.name, i)] = asText(list[i]);
			} else {
				row[f.name] = asText(obj[f.name]);
			}
		}
		// An entry column is not in the payload, only the difference it produced, so it stays blank.
		return row;
	});
}

export function initFormState(
	tool: ToolFormSpec,
	prefill?: Record<string, unknown>,
): FormState {
	const state: FormState = {
		values: {},
		bools: {},
		arrays: {},
		structs: {},
		series: {},
		shapes: {},
	};
	const groups = seriesGroupsFor(tool.name);
	for (const p of tool.params) {
		if (groups.some((g) => g.params.includes(p.name))) continue;
		if (p.kind === 'boolean') {
			state.bools[p.name] =
				typeof prefill?.[p.name] === 'boolean'
					? (prefill[p.name] as boolean)
					: p.default === true;
			continue;
		}
		if (p.kind === 'array') {
			const pre = Array.isArray(prefill?.[p.name]) ? (prefill[p.name] as unknown[]) : null;
			state.arrays[p.name] = pre ? pre.map(asText) : Array.from({ length: 3 }, () => '');
			continue;
		}
		if (p.kind === 'replicates') {
			// Rows are positions: a prefilled gap stays a blank row at its own index.
			const pre = Array.isArray(prefill?.[p.name]) ? (prefill[p.name] as unknown[]) : null;
			const rows = Math.max(pre?.length ?? 0, p.suggested ?? 3);
			state.arrays[p.name] = Array.from({ length: rows }, (_, i) => asText(pre?.[i]));
			continue;
		}
		if (p.kind === 'object' || p.kind === 'replicate_grid') {
			const shape = resolveStructShape(p);
			state.shapes[p.name] = shape;
			state.structs[p.name] =
				restoreStructRows(shape, prefill?.[p.name]) ?? emptyStructRows(shape);
			continue;
		}
		const pre = prefill?.[p.name];
		if (pre !== undefined && pre !== null) state.values[p.name] = String(pre);
		else if (p.default !== null && p.default !== undefined) state.values[p.name] = String(p.default);
		else if (p.required && enumVariants(p.kind).length > 0)
			state.values[p.name] = enumVariants(p.kind)[0];
		else state.values[p.name] = '';
	}
	for (const g of groups) {
		const lists = g.params.map((name) =>
			Array.isArray(prefill?.[name]) ? (prefill[name] as unknown[]) : null,
		);
		const len = Math.max(g.rows, ...lists.map((l) => l?.length ?? 0));
		state.series[g.title] = Array.from({ length: len }, (_, i) =>
			Object.fromEntries(g.params.map((name, pi) => [name, asText(lists[pi]?.[i])])),
		);
	}
	return state;
}

const rowIsBlank = (row: Record<string, string>) => Object.values(row).every((v) => v === '');

type StructResult = { value: unknown } | { empty: true } | { error: string };

function buildStructRow(
	shape: StructShape,
	row: Record<string, string>,
	where: string,
): { row: Record<string, unknown> } | { error: string } {
	const out: Record<string, unknown> = {};
	for (const f of shape.fields) {
		if (f.slots) {
			const list = Array.from({ length: f.slots }, (_, i) => num(row[slotCell(f.name, i)])).filter(
				(n): n is number => n !== null,
			);
			out[f.name] = list.length > 0 ? list : null;
		} else {
			out[f.name] = num(row[f.name]);
		}
		if (f.required && out[f.name] === null) {
			return { error: `${where} needs ${f.label}` };
		}
	}
	for (const c of shape.computed) {
		if (!c.target) continue;
		const a = num(row[c.minuend]);
		const b = num(row[c.subtrahend]);
		out[c.target] = a !== null && b !== null ? a - b : null;
	}
	return { row: out };
}

function buildStruct(shape: StructShape, rows: Record<string, string>[], label: string): StructResult {
	if (shape.form === 'lists') {
		const map: Record<string, number[]> = {};
		shape.fields.forEach((f, i) => {
			const list = Array.from({ length: shape.slots }, (_, s) => num(rows[i]?.[listCell(s)])).filter(
				(n): n is number => n !== null,
			);
			if (list.length > 0) map[f.name] = list;
		});
		return Object.keys(map).length > 0 ? { value: map } : { empty: true };
	}
	if (shape.form === 'object') {
		const row = rows[0] ?? {};
		if (rowIsBlank(row)) return { empty: true };
		const built = buildStructRow(shape, row, label);
		if ('error' in built) return built;
		// A single object drops what was left blank, so an absent field reads as absent.
		return { value: Object.fromEntries(Object.entries(built.row).filter(([, v]) => v !== null)) };
	}
	const out: Record<string, unknown>[] = [];
	for (const [i, row] of rows.entries()) {
		if (rowIsBlank(row)) continue;
		const built = buildStructRow(shape, row, `${label} ${rowLabelFor(shape, i)}`);
		if ('error' in built) return built;
		out.push(built.row);
	}
	return out.length > 0 ? { value: out } : { empty: true };
}

export type BuiltPayload = { payload: Record<string, unknown> } | { error: string };

export function buildPayload(tool: ToolFormSpec, state: FormState): BuiltPayload {
	const inputs = conditionInputs(tool, state);
	const groups = seriesGroupsFor(tool.name);
	const payload: Record<string, unknown> = {};
	const missing = (p: ToolParam) => `${p.label} is required`;

	for (const p of tool.params) {
		if (!paramApplies(p, inputs)) continue;
		const group = groups.find((g) => g.params.includes(p.name));
		if (group) {
			const list = (state.series[group.title] ?? [])
				.map((row) => num(row[p.name]))
				.filter((n): n is number => n !== null);
			if (list.length > 0) payload[p.name] = list;
			else if (paramRequired(p, inputs)) return { error: `${p.label} needs at least one value` };
			continue;
		}
		if (p.kind === 'boolean') {
			payload[p.name] = state.bools[p.name] ?? false;
			continue;
		}
		if (p.kind === 'replicates') {
			// Position is the replicate index, so a blank row is a null rather than a dropped cell;
			// only the trailing blanks are nothing.
			const cells = (state.arrays[p.name] ?? []).map(num);
			while (cells.length > 0 && cells[cells.length - 1] === null) cells.pop();
			if (cells.length > 0) payload[p.name] = cells;
			else if (paramRequired(p, inputs)) return { error: `${p.label} needs at least one value` };
			continue;
		}
		if (p.kind === 'array') {
			const list = (state.arrays[p.name] ?? [])
				.map(num)
				.filter((n): n is number => n !== null);
			if (list.length > 0) payload[p.name] = list;
			else if (paramRequired(p, inputs)) return { error: `${p.label} needs at least one value` };
			continue;
		}
		if (p.kind === 'object' || p.kind === 'replicate_grid') {
			const shape = state.shapes[p.name];
			if (!shape) continue;
			const built = buildStruct(shape, state.structs[p.name] ?? [], p.label);
			if ('error' in built) return built;
			if ('value' in built) payload[p.name] = built.value;
			else if (paramRequired(p, inputs)) return { error: missing(p) };
			continue;
		}
		const raw = String(state.values[p.name] ?? '').trim();
		if (raw === '') {
			if (paramRequired(p, inputs)) return { error: missing(p) };
			continue;
		}
		if (p.kind === 'string' || enumVariants(p.kind).length > 0) {
			payload[p.name] = raw;
			continue;
		}
		if (p.kind === 'integer') {
			const n = Number(raw);
			if (!Number.isInteger(n)) return { error: `${p.label} must be an integer` };
			payload[p.name] = n;
			continue;
		}
		const n = num(raw);
		if (n === null) return { error: `${p.label} must be a number` };
		payload[p.name] = n;
	}
	if (Object.keys(payload).length === 0) return { error: 'Enter at least one value' };
	return { payload };
}

/**
 * A form for the params as they now stand, keeping whatever was already typed under a name the
 * manifest still declares. The editor's preview is rebuilt on every param change, and retyping
 * the inputs after each edit would make the preview unusable for running anything.
 */
export function reseedFormState(spec: ToolFormSpec, prev: FormState): FormState {
	const next = initFormState(spec);
	for (const key of Object.keys(next.values)) {
		if (prev.values[key] !== undefined && prev.values[key] !== '') next.values[key] = prev.values[key];
	}
	for (const key of Object.keys(next.bools)) {
		if (prev.bools[key] !== undefined) next.bools[key] = prev.bools[key];
	}
	for (const key of Object.keys(next.arrays)) {
		if (prev.arrays[key]) next.arrays[key] = prev.arrays[key];
	}
	for (const key of Object.keys(next.series)) {
		if (prev.series[key]) next.series[key] = prev.series[key];
	}
	for (const key of Object.keys(next.structs)) {
		// Only when the shape still matches: rows keyed for a different set of columns are not
		// the same table.
		const sameShape = JSON.stringify(prev.shapes[key]) === JSON.stringify(next.shapes[key]);
		if (sameShape && prev.structs[key]) next.structs[key] = prev.structs[key];
	}
	return next;
}

/** A stored curve reference or a pair of coefficients, read back into the picker's selection. */
export function curveSelectionFrom(v: unknown): CurveSelection | null {
	if (typeof v !== 'object' || v === null) return null;
	const o = v as Record<string, unknown>;
	return {
		standardCurveId: typeof o.standard_curve_id === 'string' ? o.standard_curve_id : null,
		slope: typeof o.slope === 'number' ? o.slope : null,
		intercept: typeof o.intercept === 'number' ? o.intercept : null,
		label: typeof o.label === 'string' ? o.label : null,
	};
}

/** The field a curve slot contributes to the request body. */
export function curveField(sel: CurveSelection | undefined): Record<string, unknown> | null {
	if (!sel) return null;
	if (sel.standardCurveId) return { standard_curve_id: sel.standardCurveId };
	if (sel.slope !== null && sel.intercept !== null) {
		return { slope: sel.slope, intercept: sel.intercept, ...(sel.label ? { label: sel.label } : {}) };
	}
	return null;
}

export function emptyCurveSelections(spec: ToolFormSpec): Record<string, CurveSelection> {
	return Object.fromEntries(
		spec.curves.map((c) => [
			c.name,
			{ standardCurveId: null, slope: null, intercept: null, label: null },
		]),
	);
}

export function curveSelectionsFrom(
	spec: ToolFormSpec,
	source: Record<string, unknown> | undefined,
): Record<string, CurveSelection> {
	const out = emptyCurveSelections(spec);
	for (const c of spec.curves) {
		const sel = curveSelectionFrom(source?.[c.name]);
		if (sel) out[c.name] = sel;
	}
	return out;
}

/**
 * The whole request body: the params plus the curve slots, which the manifest names as fields of
 * that same body. Calculate and draft run take the identical shape, so they build it here.
 */
export function buildRequestBody(
	spec: ToolFormSpec,
	state: FormState,
	selections: Record<string, CurveSelection>,
): { body: Record<string, unknown> } | { error: string } {
	const built = buildPayload(spec, state);
	if ('error' in built) return built;
	const body = built.payload;
	for (const slot of spec.curves) {
		const field = curveField(selections[slot.name]);
		if (field) body[slot.name] = field;
		else if (slot.required) return { error: `Select or enter the ${slot.label.toLowerCase()}` };
	}
	return { body };
}
