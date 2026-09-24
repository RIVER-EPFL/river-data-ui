import type { ProvenanceRecord } from '$api/service';
import { formatDateTime } from '$lib/utils';

/** What produced a record's value, which is what its number is called on the record. */
export type ValueLabel = 'Computed' | 'Measured' | 'Entered';

/** A value a calculation produced: a derived value, one a tool or the chain saved, or a portal's. */
export function isComputed(rec: ProvenanceRecord): boolean {
	return (
		rec.readings[0]?.measurement_type === 'derived' ||
		rec.computation?.provenance != null ||
		rec.calculation != null ||
		rec.origin.portal_calculation != null
	);
}

/**
 * Computed for a calculation's value, Measured for an instrument's or a sync source's, Entered for
 * a value typed in with no instrument behind it.
 */
export function valueLabel(rec: ProvenanceRecord): ValueLabel {
	if (isComputed(rec)) return 'Computed';
	if (rec.chain.sensor || rec.origin.classification !== 'manual') return 'Measured';
	return 'Entered';
}

/** The calculation that computed a record's value and what it read, or null for one nothing computed. */
export function computedOrigin(rec: ProvenanceRecord): string | null {
	const portal = rec.origin.portal_calculation;
	if (portal) return withInputs(`computed by ${portal.function}`, portal.inputs.map((i) => i.column));
	if (!isComputed(rec)) return null;
	const inputs = (rec.inputs ?? []).map((i) => i.parameter_code ?? i.site_property ?? i.variable_name);
	if (rec.calculation) return withInputs(`computed by ${rec.calculation.code}`, inputs);
	return withInputs(rec.computation?.run_source === 'chain' ? 'computed by the chain' : 'computed by a tool', inputs);
}

function withInputs(phrase: string, inputs: string[]): string {
	const names = [...new Set(inputs)];
	return names.length > 0 ? `${phrase} from ${names.join(', ')}` : phrase;
}

/** The earliest instant a bounded window can start at; anything before it is the unbounded start. */
const UNBOUNDED_BEFORE = Date.parse('1001-01-01T00:00:00Z');

/** A reconciliation window's start, read as the beginning where the window has none. */
export function windowStartText(from: string): string {
	return Date.parse(from) < UNBOUNDED_BEFORE ? 'from the beginning' : formatDateTime(from);
}
