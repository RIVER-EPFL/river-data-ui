// What a visit's row says outside its values: the open findings, the calculation state and the
// field day's verification, on the row's index rather than beside its date.

import type { VisitCell, VisitRow } from '$api/service';
import { findingKinds, findingsChipTitle } from '$lib/visits/cell';
import { recomputeFixable, visitCalculationBadge } from '$lib/visits/recompute';
import { verificationBadge, verificationNoticeFor } from '$lib/visits/verification';

/** What each kind of review-queue hold means on the cell it stands on. */
const FINDING_TEXT: Record<string, string> = {
	replicate_stats: "The source's own statistics disagree with what its replicates compute to",
	missing_output: 'A calculation was expected to write this value and did not',
	stale_output: 'This value is older than an input it was computed from',
	skipped_output: 'The calculation declined to run for this value',
	source_modified: 'The source changed this value after it was stored',
	brake_fired: 'An ingest pass over this value tripped the brake',
	source_identity_changed: 'The device behind this feed is not the one that was there',
	curve_claim_stripped: 'A curve claim on this value was dropped: the row may not carry one',
	unverified_entry: 'Entered by hand and not yet verified',
};

export interface CellFinding {
	className: 'sheet-finding';
	title: string;
}

/** The shade and hover text a cell carrying a pending hold takes, whatever the hold's kind. */
export function cellFinding(cell: Pick<VisitCell, 'finding' | 'finding_count'> | null | undefined): CellFinding | null {
	const kind = cell?.finding;
	if (!kind) return null;
	const text = FINDING_TEXT[kind] ?? kind.replace(/_/g, ' ');
	const more = (cell.finding_count ?? 1) > 1 ? ` (${cell.finding_count} findings on this value)` : '';
	return { className: 'sheet-finding', title: `${text}${more}. Open the record to resolve it.` };
}

export interface RowHeaderState {
	/** The classes the row's index takes. */
	classNames: string[];
	title: string | null;
	/** Whether pressing the index opens the visit where its findings are read. */
	opensFindings: boolean;
}

/**
 * The row index's tone and hover text. A row with open findings is shaded, so a finding in a
 * group off screen still shows; a rejected field day is struck through and a pending one marked,
 * as the grid's key words them.
 */
export function visitRowHeader(
	visit: Pick<VisitRow, 'findings_open' | 'cells' | 'recompute' | 'unverified' | 'withdrawn_at'>,
): RowHeaderState {
	const classNames: string[] = [];
	const lines: string[] = [];
	if (visit.findings_open > 0) {
		classNames.push('sheet-finding');
		lines.push(findingsChipTitle(visit.findings_open, findingKinds(visit.cells)));
	}
	const calculation = visitCalculationBadge(visit.recompute, recomputeFixable(visit.cells));
	if (calculation) {
		lines.push(`Calculations: ${calculation.label}. ${calculation.title}`);
	}
	const state = verificationBadge(visit.unverified, visit.withdrawn_at);
	if (state) {
		classNames.push(visit.withdrawn_at ? 'sheet-struck' : 'sheet-pending');
		lines.push(verificationNoticeFor(visit.unverified, visit.withdrawn_at) ?? state.label);
	}
	return {
		classNames,
		title: lines.length ? lines.join('\n') : null,
		opensFindings: visit.findings_open > 0,
	};
}
