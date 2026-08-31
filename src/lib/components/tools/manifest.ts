// Manifest authoring model. The wire manifest leaves every list optional, which makes a form
// binding to it full of null checks; the builder shape below fills them in and `toWireManifest`
// converts back at the edges (load, inspect, save).
import type {
	ToolCurveSlot,
	ToolEventInput,
	ToolManifest,
	ToolOutput,
	ToolParam,
	ToolSection,
	ToolStationInput,
	ToolTestCases,
} from '$api/service';
import type { Parameter } from '$api/crud';

/** The closed kind vocabulary the server accepts, `enum:<a|b>` aside. */
export const PARAM_KINDS = [
	'number',
	'integer',
	'string',
	'boolean',
	'array',
	'object',
	'replicate_grid',
	'replicates',
] as const;

export const ENUM_PREFIX = 'enum:';

/** The suffix a per-replicate output key carries; the runner returns `{base}_A`, `{base}_B`, … */
export const REP_SUFFIX = '_{rep}';

export interface BuilderManifest {
	label: string;
	/** Empty string rather than null, so an input can bind straight to it. */
	description: string;
	params: ToolParam[];
	outputs: ToolOutput[];
	constants: string[];
	curves: ToolCurveSlot[];
	match_keywords: string[];
	// Carried through untouched: the editor has no fields for these yet, and re-saving a
	// version must not be what drops a declaration made in Raw JSON.
	sections: ToolSection[];
	station_inputs: ToolStationInput[];
	event_inputs: ToolEventInput[];
	qc: Record<string, unknown> | null;
}

function str(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function optStr(value: unknown): string | null {
	return typeof value === 'string' && value !== '' ? value : null;
}

function bool(value: unknown): boolean {
	return value === true;
}

function arr(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

export function emptyManifest(label = ''): BuilderManifest {
	return {
		label,
		description: '',
		params: [],
		outputs: [],
		constants: [],
		curves: [],
		match_keywords: [],
		sections: [],
		station_inputs: [],
		event_inputs: [],
		qc: null,
	};
}

/**
 * Read a stored manifest into the builder shape. Tolerant by design: a version saved by hand may
 * be missing lists or carry the wrong type in a field, and the editor has to open it anyway.
 */
export function fromManifest(raw: unknown): BuilderManifest {
	const m = (raw ?? {}) as Record<string, unknown>;
	return {
		label: str(m.label),
		description: str(m.description),
		params: arr(m.params).map((p) => {
			const o = (p ?? {}) as Record<string, unknown>;
			return {
				name: str(o.name),
				label: str(o.label),
				kind: str(o.kind, 'number'),
				units: optStr(o.units),
				required: bool(o.required),
				default: o.default ?? null,
				when: (o.when ?? null) as ToolParam['when'],
				// Carried through untouched: the editor has no field for it, and re-saving a
				// version must not be what drops a structured param's columns.
				structure: (o.structure ?? null) as ToolParam['structure'],
				description: optStr(o.description),
				section: optStr(o.section),
				parameter_code: optStr(o.parameter_code),
				suggested: typeof o.suggested === 'number' ? o.suggested : null,
				curve: optStr(o.curve),
			};
		}),
		outputs: arr(m.outputs).map((p) => {
			const o = (p ?? {}) as Record<string, unknown>;
			return {
				key: str(o.key),
				label: str(o.label),
				units: optStr(o.units),
				per_replicate: bool(o.per_replicate),
				aggregate_of: optStr(o.aggregate_of),
				aggregate: optStr(o.aggregate) as ToolOutput['aggregate'],
				parameter_id: optStr(o.parameter_id),
				suggested_parameter_code: optStr(o.suggested_parameter_code),
				sd_estimator: optStr(o.sd_estimator) as ToolOutput['sd_estimator'],
			};
		}),
		constants: arr(m.constants).filter((c): c is string => typeof c === 'string'),
		curves: arr(m.curves).map((p) => {
			const o = (p ?? {}) as Record<string, unknown>;
			return {
				name: str(o.name),
				label: str(o.label),
				required: bool(o.required),
				description: optStr(o.description),
			};
		}),
		match_keywords: arr(m.match_keywords).filter((k): k is string => typeof k === 'string'),
		sections: arr(m.sections) as ToolSection[],
		station_inputs: arr(m.station_inputs) as ToolStationInput[],
		event_inputs: arr(m.event_inputs) as ToolEventInput[],
		qc: typeof m.qc === 'object' && m.qc !== null ? (m.qc as Record<string, unknown>) : null,
	};
}

export function toWireManifest(m: BuilderManifest): ToolManifest {
	return {
		label: m.label,
		description: m.description.trim() || null,
		params: m.params,
		outputs: m.outputs,
		constants: m.constants,
		curves: m.curves,
		match_keywords: m.match_keywords,
		...(m.sections.length > 0 ? { sections: m.sections } : {}),
		...(m.station_inputs.length > 0 ? { station_inputs: m.station_inputs } : {}),
		...(m.event_inputs.length > 0 ? { event_inputs: m.event_inputs } : {}),
		...(m.qc ? { qc: m.qc } : {}),
	};
}

export function parseTestCases(raw: unknown): ToolTestCases {
	const t = (raw ?? {}) as Record<string, unknown>;
	const cases = arr(t.cases) as ToolTestCases['cases'];
	// The stored blob is spread through: the seeded case sets carry a `notes` field recording where
	// each expectation came from, and editing a case must not be what deletes that provenance.
	return {
		...t,
		...(typeof t.tolerance === 'number' ? { tolerance: t.tolerance } : {}),
		cases: cases ?? [],
	};
}

/** `enum:a|b` collapses to `enum` so a select can hold the vocabulary in one option list. */
export function kindBase(kind: string): string {
	return kind.startsWith(ENUM_PREFIX) ? 'enum' : kind;
}

export function enumVariants(kind: string): string[] {
	if (!kind.startsWith(ENUM_PREFIX)) return [];
	return kind
		.slice(ENUM_PREFIX.length)
		.split('|')
		.filter((v) => v !== '');
}

export function makeEnumKind(variantsText: string): string {
	const variants = variantsText
		.split('|')
		.map((v) => v.trim())
		.filter((v) => v !== '');
	return ENUM_PREFIX + variants.join('|');
}

/**
 * A starting kind for a symbol the script reads but the manifest does not declare. Numbers are by
 * far the common case in these tools, so anything without a naming signal starts there and the
 * author corrects it in one select.
 */
export function guessKind(name: string): string {
	const n = name.toLowerCase();
	if (/^(is|has|use|do|apply|include)_/.test(n) || n.endsWith('_flag')) return 'boolean';
	if (/(^|_)(n|count|index|reps|replicates)$/.test(n)) return 'integer';
	if (/(^|_)(method|mode|type|units|label|name|id)$/.test(n)) return 'string';
	if (/(^|_)(grid|rows|series|values|times|diameters|weights)$/.test(n)) return 'replicate_grid';
	return 'number';
}

/** `co2_ppm` reads as "Co2 ppm": a starting label, not a claim about the right one. */
export function humanize(name: string): string {
	const spaced = name.replace(/[_-]+/g, ' ').trim();
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function formatDefault(value: unknown): string {
	if (value === null || value === undefined) return '';
	if (typeof value === 'string') return value;
	return JSON.stringify(value);
}

/**
 * Text back into a typed default. Empty text is "no default" for every kind, which does mean an
 * intentional empty-string default cannot be typed; it has no use in these tools and the raw JSON
 * view remains the way to set one.
 */
export function parseDefault(text: string, kind: string): { value: unknown; error: string } {
	const t = text.trim();
	if (t === '') return { value: null, error: '' };
	if (kind.startsWith(ENUM_PREFIX)) {
		const variants = enumVariants(kind);
		return variants.includes(t)
			? { value: t, error: '' }
			: { value: null, error: `Not one of ${variants.join(', ')}` };
	}
	switch (kind) {
		case 'number': {
			const n = Number(t);
			return Number.isFinite(n) ? { value: n, error: '' } : { value: null, error: 'Not a number' };
		}
		case 'integer': {
			const n = Number(t);
			return Number.isInteger(n)
				? { value: n, error: '' }
				: { value: null, error: 'Not an integer' };
		}
		case 'boolean':
			if (t === 'true') return { value: true, error: '' };
			if (t === 'false') return { value: false, error: '' };
			return { value: null, error: 'Use true or false' };
		case 'string':
			return { value: text, error: '' };
		case 'array':
		case 'replicate_grid':
		case 'object':
			try {
				const parsed: unknown = JSON.parse(t);
				const wantsArray = kind !== 'object';
				const ok = wantsArray
					? Array.isArray(parsed)
					: typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
				return ok
					? { value: parsed, error: '' }
					: { value: null, error: wantsArray ? 'Not a JSON array' : 'Not a JSON object' };
			} catch {
				return { value: null, error: 'Not valid JSON' };
			}
		default:
			return { value: text, error: '' };
	}
}

export function blankParam(name = '', kind = 'number'): ToolParam {
	return {
		name,
		label: name ? humanize(name) : '',
		kind,
		units: null,
		required: false,
		default: null,
		when: null,
	};
}

export function blankOutput(key = '', per_replicate = false): ToolOutput {
	return {
		key: withRepSuffix(key, per_replicate),
		label: key ? humanize(key) : '',
		units: null,
		per_replicate,
		aggregate_of: null,
		parameter_id: null,
		suggested_parameter_code: null,
		sd_estimator: null,
	};
}

/**
 * How one output's value is stored. The three outcomes are mutually exclusive but the manifest
 * spells them across two independent fields, so the editor reads and writes them through here
 * rather than leaving an author to combine the fields correctly.
 */
export type OutputStorage = 'replicates' | 'single' | 'not_stored';

/**
 * A value with no catalog parameter has nowhere to be written, so the parameter link is what makes
 * an output stored. `aggregate_of` stays what it is on the wire (the server reads any non-null
 * value as display-only) and names the summary source where there is one, which a diagnostic that
 * summarises nothing does not have.
 */
export function outputStorage(o: ToolOutput): OutputStorage {
	if (!hasParameterLink(o) || o.aggregate_of) return 'not_stored';
	return o.per_replicate ? 'replicates' : 'single';
}

/** True when an output is saved to the catalog. */
export function isStored(o: ToolOutput): boolean {
	return outputStorage(o) !== 'not_stored';
}

/** Whether an output names a catalog parameter by either half of the declaration. */
export function hasParameterLink(o: ToolOutput): boolean {
	return !!o.parameter_id || !!o.suggested_parameter_code;
}

/**
 * What an output's declaration resolves to in a given catalog, by the server's rule: `parameter_id`
 * first, then `suggested_parameter_code` case-insensitively. Resolved once per row and handed to
 * everything that reads it, so the picker's account of the link and the units the row inherits
 * cannot disagree.
 */
export interface ParameterResolution {
	parameter: Parameter | null;
	by: 'id' | 'code';
	/** The id names no row in this catalog; the code carried the link instead. */
	dangling: boolean;
	/** The output names a parameter that resolves to nothing at all. */
	dead: boolean;
}

export function resolveOutputParameter(
	o: ToolOutput,
	byId: Map<string, Parameter>,
	byCode: Map<string, Parameter>,
): ParameterResolution {
	if (o.parameter_id) {
		const hit = byId.get(o.parameter_id);
		if (hit) return { parameter: hit, by: 'id', dangling: false, dead: false };
	}
	const byCodeHit = o.suggested_parameter_code
		? (byCode.get(o.suggested_parameter_code.toLowerCase()) ?? null)
		: null;
	return {
		parameter: byCodeHit,
		by: 'code',
		dangling: !!o.parameter_id && !!byCodeHit,
		dead: !byCodeHit && hasParameterLink(o),
	};
}

/** Units compare on trimmed case, so `uM` and `um ` are the same unit rather than a mismatch. */
export function sameUnits(a: string | null, b: string | null): boolean {
	return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
}

export function blankCurve(name = ''): ToolCurveSlot {
	return { name, label: name ? humanize(name) : '', required: false };
}

/** Add `_{rep}` to a key, or take it away, without disturbing the rest of the key. */
export function withRepSuffix(key: string, per_replicate: boolean): string {
	const base = key.replace(/_?\{rep\}/, '');
	return per_replicate ? base + REP_SUFFIX : base;
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
	if (to < 0 || to >= list.length) return list;
	const next = [...list];
	const [item] = next.splice(from, 1);
	next.splice(to, 0, item);
	return next;
}
