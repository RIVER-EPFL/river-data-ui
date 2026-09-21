import type { ConsumedInput, ConsumedMember } from '$api/service';
import { NO_VALUE } from '$lib/format';
import { writePointParams } from '$lib/provenance/pointLink';

/** What a consumed input is bound to, in words a reader of the record recognises. */
const KIND_LABEL: Record<string, string> = {
	reading: 'reading',
	mean: 'sample mean',
	replicates: 'replicates',
	site: 'site property',
	constant: 'constant',
	curve: 'standard curve',
	step: 'calculation step',
};

export function kindLabel(kind: string): string {
	return KIND_LABEL[kind] ?? kind;
}

/** The badge a mark reads as: a moved source warns, a source nothing can be said about is muted. */
export function markVariant(state: string): 'ok' | 'warning' | 'muted' {
	if (state === 'changed') return 'warning';
	if (state === 'unchanged') return 'ok';
	return 'muted';
}

export function markTip(state: string): string {
	if (state === 'changed') return 'The source has moved since the calculation read it.';
	if (state === 'unchanged') return 'The source still stands where the calculation read it.';
	return 'Nothing the calculation read here names a source, so no comparison can be made.';
}

/** The point record a consumed reading opens; null while its stream is unpaired. */
export function memberHref(basePath: string, member: ConsumedMember): string | null {
	const point = member.point;
	if (!point) return null;
	const params = new URLSearchParams();
	writePointParams(params, {
		siteParameterId: point.site_parameter_id,
		// The instant as the site page writes it back, so opening the link settles the URL.
		timeIso: new Date(point.time).toISOString(),
		measurementType: point.measurement_type === 'spot' ? 'spot' : 'continuous',
	});
	return `${basePath}/sites/${point.site_id}?${params}`;
}

/** The value a consumed input read, as one line. A list is printed in order, a gap as a hyphen. */
export function consumedText(value: unknown): string {
	if (value === null || value === undefined) return NO_VALUE;
	if (Array.isArray(value)) return value.map((v) => consumedText(v)).join(', ');
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (typeof value === 'string') return value;
	if (typeof value === 'object') {
		const o = value as Record<string, unknown>;
		if (typeof o.slope === 'number' && typeof o.intercept === 'number') {
			return `slope ${o.slope}, intercept ${o.intercept}`;
		}
	}
	return JSON.stringify(value);
}

/**
 * The consumed set of one record, the inputs a reader follows first. A calculation step is the
 * pinned formula rather than a value read, so it sorts after the values it was applied to.
 */
export function orderedInputs(consumed: ConsumedInput[]): ConsumedInput[] {
	return [...consumed].sort((a, b) => {
		const step = Number(a.kind === 'step') - Number(b.kind === 'step');
		return step !== 0 ? step : a.variable.localeCompare(b.variable);
	});
}

/** Whether any input of the set has moved since the calculation read it. */
export function anyChanged(consumed: ConsumedInput[]): boolean {
	return consumed.some((c) => c.state === 'changed');
}
