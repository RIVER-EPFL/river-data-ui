// One validation model for the tool authoring page.
//
// The save gate, the section headers and the field highlighting all read this list, so the three
// surfaces cannot disagree about what is wrong. Severity is decided by one rule: blocking is what
// the server would refuse (or what cannot run), advisory is everything else.

import { isToolParamCondition, type ToolInspectResponse, type ToolLintFinding } from '$api/service';
import type { Parameter } from '$api/crud';
import {
	ENUM_PREFIX,
	PARAM_KINDS,
	REP_SUFFIX,
	enumVariants,
	hasParameterLink,
	resolveOutputParameter,
	sameUnits,
	type BuilderManifest,
} from '$components/tools/manifest';

export type Severity = 'blocking' | 'advisory';

export type SectionId =
	| 'script'
	| 'detection'
	| 'declaration'
	| 'params'
	| 'outputs'
	| 'aux'
	| 'cases';

export interface Finding {
	severity: Severity;
	section: SectionId;
	/** One line, naming the row it belongs to. */
	message: string;
	/** The id of the field to focus, when the finding belongs to one. */
	target: string | null;
}

export interface ValidationInput {
	script: string;
	inspection: ToolInspectResponse | null;
	lint: ToolLintFinding[];
	manifest: BuilderManifest;
	/** Per output row: the author chose "not stored". Intent the manifest alone cannot carry. */
	notStored: boolean[];
	/** Per param row: why its default text does not parse, empty when it does. */
	defaultErrors: string[];
	catalogById: Map<string, Parameter>;
	catalogByCode: Map<string, Parameter>;
	caseCount: number;
}

export const paramField = (i: number, field: string) => `tm-param-${i}-${field}`;
export const outputField = (i: number, field: string) => `tm-out-${i}-${field}`;
export const curveField = (i: number, field: string) => `tm-curve-${i}-${field}`;
export const constantField = (i: number) => `tm-const-${i}`;
export const SCRIPT_FIELD = 'tm-source';
export const LABEL_FIELD = 'tm-mlabel';

function duplicateIndices(values: string[]): Set<number> {
	const seen = new Map<string, number>();
	const dupes = new Set<number>();
	values.forEach((v, i) => {
		if (v === '') return;
		const first = seen.get(v);
		if (first === undefined) seen.set(v, i);
		else dupes.add(i);
	});
	return dupes;
}

/**
 * Replicate families the script builds while it runs. They cannot appear in the detected output
 * list, so without reading them a per-replicate family is invisible to the comparison.
 */
const REP_PASTE = /paste0\(\s*(["'])([A-Za-z0-9_.]*[A-Za-z0-9.])_\1\s*,\s*([A-Za-z_][\w.]*)\s*[,)]/g;
const REP_VARIABLES = ['rep', 'reps', 'replicate', 'replicates', 'r', 'letter'];

export function declaredRepBases(declaredOutputKeys: string[]): string[] {
	return declaredOutputKeys
		.filter((k) => k.includes('{rep}'))
		.map((k) => k.replace(/_?\{rep\}/, ''))
		.filter((b) => b !== '');
}

export function dynamicRepBases(
	inspection: ToolInspectResponse | null,
	declaredOutputKeys: string[],
): string[] {
	const declared = declaredRepBases(declaredOutputKeys);
	const found = new Set<string>();
	for (const expr of inspection?.dynamic_outputs.expressions ?? []) {
		for (const m of expr.matchAll(REP_PASTE)) {
			const [, , stem, variable] = m;
			if (!REP_VARIABLES.includes(variable.toLowerCase())) continue;
			found.add(stem);
		}
	}
	return [...found]
		.filter((b) => !declared.includes(b))
		.filter((b) => !declaredOutputKeys.includes(`${b}${REP_SUFFIX}`))
		.sort();
}

/** Reconciliation covers inputs, constants and curves but not outputs, so outputs are compared here. */
export function undeclaredOutputs(
	inspection: ToolInspectResponse | null,
	declaredOutputKeys: string[],
): string[] {
	if (!inspection) return [];
	const bases = [...declaredRepBases(declaredOutputKeys), ...dynamicRepBases(inspection, declaredOutputKeys)];
	return inspection.outputs.filter(
		(k) => !declaredOutputKeys.includes(k) && !bases.some((b) => k === b || k.startsWith(`${b}_`)),
	);
}

function scriptFindings(input: ValidationInput, out: Finding[]) {
	const block = (message: string) =>
		out.push({ severity: 'blocking', section: 'script', message, target: SCRIPT_FIELD });
	if (!input.script.trim()) {
		block('No R script.');
		return;
	}
	const parseError = input.inspection?.parse_error ?? null;
	if (parseError) {
		block(parseError.line != null ? `Line ${parseError.line}: ${parseError.message}` : parseError.message);
	}
	if (input.inspection && input.inspection.parse_ok && !input.inspection.entry_found) {
		block(`No function named ${input.inspection.entry} is defined.`);
	}
	for (const f of input.lint) block(`Line ${f.line}: ${f.message}`);
}

function paramFindings(input: ValidationInput, out: Finding[]) {
	const params = input.manifest.params;
	const names = params.map((p) => p.name.trim());
	const dupes = duplicateIndices(names);
	params.forEach((p, i) => {
		const named = p.name.trim() || `Param ${i + 1}`;
		if (!p.name.trim())
			out.push({ severity: 'blocking', section: 'params', message: `Param ${i + 1} has no name.`, target: paramField(i, 'name') });
		if (dupes.has(i))
			out.push({ severity: 'blocking', section: 'params', message: `${named} is declared twice.`, target: paramField(i, 'name') });
		if (!p.label.trim())
			out.push({ severity: 'blocking', section: 'params', message: `${named} has no label.`, target: paramField(i, 'label') });
		if (p.kind.startsWith(ENUM_PREFIX) && enumVariants(p.kind).length === 0)
			out.push({ severity: 'blocking', section: 'params', message: `${named} is an enum with no variants.`, target: paramField(i, 'variants') });
		if (!p.kind.startsWith(ENUM_PREFIX) && !(PARAM_KINDS as readonly string[]).includes(p.kind))
			out.push({ severity: 'blocking', section: 'params', message: `${named} has kind "${p.kind}".`, target: paramField(i, 'kind') });
		if (input.defaultErrors[i])
			out.push({ severity: 'blocking', section: 'params', message: `${named} default: ${input.defaultErrors[i]}.`, target: paramField(i, 'default') });
		const when = p.when;
		if (when !== null && isToolParamCondition(when) && !names.includes(when.param))
			out.push({ severity: 'blocking', section: 'params', message: `${named} is conditional on ${when.param}, which is not declared.`, target: paramField(i, 'name') });
	});
}

function outputFindings(input: ValidationInput, out: Finding[]) {
	const outputs = input.manifest.outputs;
	const dupes = duplicateIndices(outputs.map((o) => o.key.trim()));
	outputs.forEach((o, i) => {
		const named = o.key.trim() || `Output ${i + 1}`;
		if (!o.key.trim())
			out.push({ severity: 'blocking', section: 'outputs', message: `Output ${i + 1} has no key.`, target: outputField(i, 'key') });
		if (dupes.has(i))
			out.push({ severity: 'blocking', section: 'outputs', message: `${named} is declared twice.`, target: outputField(i, 'key') });
		if (!o.label.trim())
			out.push({ severity: 'blocking', section: 'outputs', message: `${named} has no label.`, target: outputField(i, 'label') });
		if (o.per_replicate && !o.key.includes('{rep}'))
			out.push({ severity: 'blocking', section: 'outputs', message: `${named} is per replicate, so its key needs ${REP_SUFFIX}.`, target: outputField(i, 'key') });
		if (!input.notStored[i] && !hasParameterLink(o))
			out.push({ severity: 'blocking', section: 'outputs', message: `${named} is stored and has no catalog parameter.`, target: outputField(i, 'parameter') });

		const resolution = resolveOutputParameter(o, input.catalogById, input.catalogByCode);
		if (resolution.dead)
			out.push({ severity: 'advisory', section: 'outputs', message: `${named}: ${o.suggested_parameter_code ?? o.parameter_id} is not in the catalog.`, target: outputField(i, 'parameter') });
		else if (resolution.dangling)
			out.push({ severity: 'advisory', section: 'outputs', message: `${named}: the stored id is not in this catalog, the code resolves instead.`, target: outputField(i, 'parameter') });
		if (resolution.parameter && !sameUnits(o.units, resolution.parameter.default_units))
			out.push({ severity: 'advisory', section: 'outputs', message: `${named}: units differ from ${resolution.parameter.code} (${resolution.parameter.default_units || 'unitless'}).`, target: outputField(i, 'units') });
		if (o.aggregate_of && hasParameterLink(o))
			out.push({ severity: 'advisory', section: 'outputs', message: `${named} summarises another output and links a parameter; a summary is never written.`, target: outputField(i, 'storage') });
	});
}

function auxFindings(input: ValidationInput, out: Finding[]) {
	const constants = input.manifest.constants.map((c) => c.trim());
	const constDupes = duplicateIndices(constants);
	constants.forEach((c, i) => {
		if (c === '')
			out.push({ severity: 'blocking', section: 'aux', message: `Constant ${i + 1} has no name.`, target: constantField(i) });
		if (constDupes.has(i))
			out.push({ severity: 'blocking', section: 'aux', message: `Constant ${c} is listed twice.`, target: constantField(i) });
	});
	const curves = input.manifest.curves.map((c) => c.name.trim());
	const curveDupes = duplicateIndices(curves);
	curves.forEach((name, i) => {
		if (name === '')
			out.push({ severity: 'blocking', section: 'aux', message: `Curve slot ${i + 1} has no name.`, target: curveField(i, 'name') });
		if (curveDupes.has(i))
			out.push({ severity: 'blocking', section: 'aux', message: `Curve slot ${name} is declared twice.`, target: curveField(i, 'name') });
	});
}

function detectionFindings(input: ValidationInput, out: Finding[]) {
	const inspection = input.inspection;
	if (!inspection) return;
	// A script that does not parse yields no reads, so every declared symbol reads as unused and
	// every returned key as missing. The parse error is the only finding worth showing.
	if (!inspection.parse_ok) return;
	const rec = inspection.reconciliation;
	const advisory = (message: string) =>
		out.push({ severity: 'advisory', section: 'detection', message, target: null });
	const keys = input.manifest.outputs.map((o) => o.key);
	for (const name of rec?.undeclared_inputs ?? []) advisory(`${name} is read and not declared.`);
	for (const name of rec?.undeclared_constants ?? []) advisory(`${name} is read and not declared.`);
	for (const name of rec?.undeclared_curves ?? []) advisory(`${name} is read and not declared.`);
	for (const base of dynamicRepBases(inspection, keys)) advisory(`${base}${REP_SUFFIX} is built at run time and not declared.`);
	for (const key of undeclaredOutputs(inspection, keys)) advisory(`${key} is returned and not declared.`);
	// A script that builds input names at run time (inputs[[paste0(...)]]) hides its reads from
	// static inspection, so an unread report would name every dynamically read symbol.
	if (rec?.reads_complete) {
		for (const name of rec.unread_params) advisory(`${name} is declared and not read.`);
		for (const name of rec.unread_constants) advisory(`${name} is declared and not read.`);
		for (const name of rec.unread_curves) advisory(`${name} is declared and not read.`);
	}
}

export function validate(input: ValidationInput): Finding[] {
	const out: Finding[] = [];
	scriptFindings(input, out);
	if (!input.manifest.label.trim())
		out.push({ severity: 'blocking', section: 'declaration', message: 'The manifest has no label.', target: LABEL_FIELD });
	paramFindings(input, out);
	outputFindings(input, out);
	auxFindings(input, out);
	detectionFindings(input, out);
	if (input.caseCount === 0)
		out.push({ severity: 'advisory', section: 'cases', message: 'No test cases, so this version cannot be validated.', target: null });
	// Blocking first: the save bar reads in this order, and so does every section count.
	return [...out.filter((f) => f.severity === 'blocking'), ...out.filter((f) => f.severity === 'advisory')];
}

export interface SectionCount {
	blocking: number;
	advisory: number;
}

export function countSection(findings: Finding[], ...sections: SectionId[]): SectionCount {
	const inSection = findings.filter((f) => sections.includes(f.section));
	return {
		blocking: inSection.filter((f) => f.severity === 'blocking').length,
		advisory: inSection.filter((f) => f.severity === 'advisory').length,
	};
}

/** The worst severity attached to each field, for the fields the author has already visited. */
export function fieldMarks(findings: Finding[], touched: Record<string, boolean>): Record<string, Severity> {
	const marks: Record<string, Severity> = {};
	for (const f of findings) {
		if (!f.target || !touched[f.target]) continue;
		if (marks[f.target] !== 'blocking') marks[f.target] = f.severity;
	}
	return marks;
}

export function markClass(severity: Severity | undefined): string {
	if (severity === 'blocking') return 'border-severity-alarm-border bg-severity-alarm-soft';
	if (severity === 'advisory') return 'border-severity-warning-border bg-severity-warning-soft';
	return '';
}

/** Open the section a finding lives in, then put the cursor in its field. */
export function focusTarget(target: string | null) {
	if (!target) return;
	const el = document.getElementById(target);
	if (!el) return;
	el.closest('details')?.setAttribute('open', '');
	el.scrollIntoView({ block: 'center', behavior: 'smooth' });
	const focusable = el.matches('input, select, textarea, button')
		? el
		: el.querySelector<HTMLElement>('input, select, textarea, [contenteditable="true"]');
	focusable?.focus();
}
