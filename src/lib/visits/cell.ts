import type { EventCell, VisitCell } from '$api/service';

export interface CellMarker {
	text: string;
	title: string;
}

/**
 * The character a wide-table cell carries beside its value. Colour is the secondary channel: a
 * flagged or withdrawn group has to be tellable from a clean one in monochrome and at a glance,
 * and the marks match the expanded grid's key (`* flagged · † withdrawn at source`).
 */
export function visitCellMarker(cell: VisitCell): CellMarker | null {
	const flagged = cell.flagged || cell.n_flagged > 0;
	const withdrawn = cell.withdrawn || cell.n_withdrawn > 0;
	if (!flagged && !withdrawn) return null;
	const parts: string[] = [];
	if (flagged) parts.push(`${cell.n_flagged || cell.n_total} of ${cell.n_total} flagged`);
	if (withdrawn) parts.push(`${cell.n_withdrawn || cell.n_total} of ${cell.n_total} withdrawn at source`);
	const excluded = cell.flagged || cell.withdrawn ? 'nothing is served' : 'the mean excludes them';
	return {
		text: `${flagged ? '*' : ''}${withdrawn ? '†' : ''}`,
		title: `${parts.join(', ')}: ${excluded}`,
	};
}

export interface VisitCounts {
	parameters: number;
	replicates: number;
	flagged: number;
	withdrawn: number;
	findings: number;
}

/** The expanded visit's header line, counted from the grid it sits above. */
export function visitCounts(cells: EventCell[]): VisitCounts {
	const counts: VisitCounts = { parameters: cells.length, replicates: 0, flagged: 0, withdrawn: 0, findings: 0 };
	for (const cell of cells) {
		counts.replicates += cell.replicates.length;
		for (const r of cell.replicates) {
			if (r.flagged) counts.flagged += 1;
			if (r.withdrawn) counts.withdrawn += 1;
		}
		if (cell.finding) counts.findings += 1;
	}
	return counts;
}
