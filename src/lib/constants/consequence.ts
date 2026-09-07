import type { ToolDescriptor } from '$api/service';

/** The active calculations that read a constant, so an edit can say what it reaches. */
export function toolsDeclaring(tools: ToolDescriptor[], name: string): ToolDescriptor[] {
	if (!name) return [];
	return tools.filter((t) => t.constants.includes(name));
}

/**
 * What saving a new value does. Nothing is rewritten by the save: the audit is report-only and
 * repair is a scoped recompute someone asks for.
 */
export function valueChangeConsequence(declaring: string[]): string {
	if (declaring.length === 0) {
		return 'No active calculation reads this constant, so changing its value changes nothing that is already stored.';
	}
	const plural = declaring.length === 1 ? 'calculation reads' : 'calculations read';
	return `${declaring.length} active ${plural} this constant (${declaring.join(', ')}). Saving a new value rewrites nothing: every stored output keeps the value it was computed with, and an audit files a finding in the review queue for each one that disagrees. Repair them with a recompute from the visit or the site.`;
}
