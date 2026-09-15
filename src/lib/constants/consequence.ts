import type { ClosureResponse, ToolDescriptor } from '$api/service';
import { formatCount } from '$lib/format';

/** What the record already holds that was computed from a constant. */
export type StoredUsage = NonNullable<ClosureResponse['stored']>;

/** The active calculations that read a constant, so an edit can say what it reaches. */
export function toolsDeclaring(tools: ToolDescriptor[], name: string): ToolDescriptor[] {
	if (!name) return [];
	return tools.filter((t) => t.constants.includes(name));
}

const plural = (n: number, one: string) => `${formatCount(n)} ${one}${n === 1 ? '' : 's'}`;

/**
 * What saving a new value does. A constant carries no versions, so there is no arm that leaves old
 * readings on the old value: the save recomputes every visit whose provenance names the constant.
 */
export function valueChangeConsequence(declaring: string[], stored?: StoredUsage): string {
	if (declaring.length === 0) {
		return 'No active calculation reads this constant, so changing its value changes nothing that is already stored.';
	}
	const reads = declaring.length === 1 ? 'calculation reads' : 'calculations read';
	// Three states, because "no readings" and "the counts have not arrived" are different claims.
	let scope: string;
	if (!stored) {
		scope = 'Saving a new value recomputes every visit whose stored provenance names it.';
	} else if (stored.readings === 0) {
		scope =
			'Nothing stored was computed from it yet, so a new value takes effect from the next calculation.';
	} else {
		scope = `${plural(stored.readings, 'reading')} at ${plural(stored.visits, 'visit')} were computed from the stored value and will be recomputed.`;
	}
	return `${declaring.length} active ${reads} this constant (${declaring.join(', ')}). ${scope}`;
}
