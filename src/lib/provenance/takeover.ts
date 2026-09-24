import type { ParameterTakeover } from '$api/service';
import { formatDate } from '$lib/utils';

/** The line a provenance view shows for a series a calculation took over (Q299). */
export function takeoverText(code: string | null | undefined, t: ParameterTakeover): string {
	const before =
		t.kind === 'decommissioned'
			? `the decommissioned calculation ${t.computed_by}`
			: `the portal's ${t.computed_by}`;
	const who = t.by ? ` (${t.by})` : '';
	return `${code ?? 'This series'} continued by ${t.calculation} from ${formatDate(t.at)}${who}; computed before by ${before}`;
}
