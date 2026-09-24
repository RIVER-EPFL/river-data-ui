import { visitSourceLabel } from './recompute';

export interface VisitFact {
	label: string;
	value: string;
}

export interface VisitMetadata {
	collected_at: string;
	source: string;
	created_by?: string | null;
	unverified: boolean;
	withdrawn_at?: string | null;
}

/** The read-only facts a visit's panel opens with, each a label over its value. */
export function visitFacts(visit: VisitMetadata, formatTime: (iso: string) => string): VisitFact[] {
	const facts: VisitFact[] = [
		{ label: 'Collected at', value: formatTime(visit.collected_at) },
		{ label: 'Source', value: visitSourceLabel(visit.source) },
	];
	if (visit.created_by) facts.push({ label: 'Created by', value: visit.created_by });
	facts.push({ label: 'Verification', value: verificationText(visit, formatTime) });
	return facts;
}

function verificationText(visit: VisitMetadata, formatTime: (iso: string) => string): string {
	if (visit.withdrawn_at) return `Rejected on ${formatTime(visit.withdrawn_at)}`;
	return visit.unverified ? 'Pending review' : 'Accepted';
}

/** Whether the drafted notes differ from the stored ones, blank and absent reading alike. */
export function notesChanged(draft: string, stored: string | null | undefined): boolean {
	return draft.trim() !== (stored ?? '').trim();
}
