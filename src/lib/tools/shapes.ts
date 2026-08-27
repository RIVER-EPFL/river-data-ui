// The entry shape of a structured tool param (kind `object` or `replicate_grid`).
//
// The param's `structure` declaration is what the columns come from, so a tool authored in the
// portal renders without this file knowing its name. A structured param that declares nothing
// leaves the operator naming the columns, which is the only way to enter such a value at all.

import type { ToolParam, ToolStructField, ToolStructure } from '$api/service';

export interface StructField {
	name: string;
	label: string;
	units?: string | null;
	required?: boolean;
	/** The field holds a list of numbers, entered as this many inputs. */
	slots?: number;
}

/** A column that is typed in but never sent: it exists to feed a computed field. */
export interface EntryColumn {
	name: string;
	label: string;
	units?: string | null;
}

/** `minuend - subtrahend` over two cells of the same row. */
export interface ComputedColumn {
	label: string;
	units?: string | null;
	/** The field this fills; null shows the number without sending it. */
	target: string | null;
	minuend: string;
	subtrahend: string;
}

/**
 * `object` sends one object, `rows` an array of objects, `lists` an object of number lists
 * keyed by field name.
 */
export type StructForm = 'object' | 'rows' | 'lists';

export interface StructShape {
	form: StructForm;
	fields: StructField[];
	entry: EntryColumn[];
	computed: ComputedColumn[];
	/** Rows shown before anything is entered. */
	rows: number;
	maxRows: number | null;
	/** `lists` only: values per field, entered as this many columns. */
	slots: number;
	slotLabels: string[];
	rowLabel: 'letters' | 'numbers';
	/** Nothing declared the columns, so the operator adds them by name. */
	dynamic: boolean;
}

type ShapeInput = Partial<StructShape> & Pick<StructShape, 'form' | 'fields'>;

function shape(spec: ShapeInput): StructShape {
	return {
		entry: [],
		computed: [],
		rows: 1,
		maxRows: null,
		slots: 1,
		slotLabels: [],
		rowLabel: 'letters',
		dynamic: false,
		...spec,
	};
}

export const letterLabel = (i: number) => String.fromCharCode(65 + i);

export function rowLabelFor(shapeOf: StructShape, i: number): string {
	return shapeOf.rowLabel === 'letters' ? letterLabel(i) : String(i + 1);
}

export const slotCell = (field: string, i: number) => `${field}#${i}`;
export const listCell = (i: number) => `#${i}`;

function humanize(name: string): string {
	const spaced = name.replace(/_/g, ' ').trim();
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Two array params entered side by side because their positions pair up. */
export interface SeriesGroup {
	title: string;
	params: string[];
	rows: number;
}

// Parallel series, which a manifest states no more than it states a struct's columns.
const SERIES_GROUPS: Record<string, SeriesGroup[]> = {
	discharge: [{ title: 'Tracer series', params: ['times_s', 'values'], rows: 10 }],
};

export function seriesGroupsFor(toolName: string): SeriesGroup[] {
	return SERIES_GROUPS[toolName] ?? [];
}

const label = (f: ToolStructField) => f.label || humanize(f.name);
const units = (f: ToolStructField) => f.units ?? null;

/**
 * The declaration read into the three kinds of column the table draws: the fields an operator
 * types and the request carries, the ones typed only to feed a computed column, and the computed
 * columns themselves. Declaration order is kept within each kind.
 */
function shapeFromStructure(declared: ToolStructure): StructShape {
	const fields: StructField[] = [];
	const entry: EntryColumn[] = [];
	const computed: ComputedColumn[] = [];
	for (const f of declared.fields) {
		if (f.computed) {
			computed.push({
				label: label(f),
				units: units(f),
				target: f.send === false ? null : f.name,
				minuend: f.computed.subtract[0],
				subtrahend: f.computed.subtract[1],
			});
		} else if (f.send === false) {
			entry.push({ name: f.name, label: label(f), units: units(f) });
		} else {
			fields.push({
				name: f.name,
				label: label(f),
				units: units(f),
				required: f.required === true,
				slots: f.values > 1 ? f.values : undefined,
			});
		}
	}
	return shape({
		form: declared.layout,
		fields,
		entry,
		computed,
		rows: Math.max(1, declared.rows ?? 1),
		maxRows: declared.max_rows ?? null,
		slots: Math.max(1, declared.values ?? 1),
		slotLabels: declared.value_labels ?? [],
		rowLabel: declared.row_labels === 'numbers' ? 'numbers' : 'letters',
	});
}

export function resolveStructShape(param: ToolParam): StructShape {
	if (param.structure && param.structure.fields.length > 0) {
		return shapeFromStructure(param.structure);
	}
	return shape({
		form: param.kind === 'replicate_grid' ? 'rows' : 'object',
		fields: [],
		rows: param.kind === 'replicate_grid' ? 3 : 1,
		dynamic: true,
	});
}

/** A column the operator named, appended to a shape whose fields nothing declared. */
export function withAddedField(shapeOf: StructShape, name: string): StructShape {
	return { ...shapeOf, fields: [...shapeOf.fields, { name, label: humanize(name) }] };
}

export { humanize };
