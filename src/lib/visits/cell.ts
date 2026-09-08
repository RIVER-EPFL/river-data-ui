import type { EventCell, EventDetailResponse, ProvenanceRecord, ProvenanceResponse, VisitCell } from '$api/service';
import { formatMeasurement } from '$lib/format';
import type { GridRow } from './grid';

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

/**
 * The statistics line a grid cell carries on hover: how many vials, how far apart they were, and
 * under which divisor. An sd whose formula is not named is one two readers can compare and reach
 * opposite conclusions about, which is why the estimator travels with every number that has one.
 */
export function visitCellStatistics(
	cell: VisitCell,
	decimals?: number | null,
	units?: string | null
): string | null {
	if (cell.n == null || cell.n < 1) return null;
	const fmt = (v: number | null | undefined) =>
		v == null ? null : formatMeasurement(v, decimals);
	const unit = units ? ` ${units}` : '';
	const parts = [`n = ${cell.n}`];
	const sd = fmt(cell.stdev);
	if (sd != null) parts.push(`SD ${sd}${unit} (${estimatorWord(cell.sd_estimator)})`);
	const median = fmt(cell.median);
	if (median != null) parts.push(`median ${median}${unit}`);
	const min = fmt(cell.min);
	const max = fmt(cell.max);
	if (min != null && max != null) parts.push(`range ${min} to ${max}${unit}`);
	if (cell.sd_estimator_source === 'default')
		parts.push('divisor not declared for this parameter');
	return parts.join(' · ');
}

/** Two words for a divisor, for a line that is already long. */
export function estimatorWord(estimator: string | null | undefined): string {
	return estimator === 'population' ? 'population, n' : 'sample, n-1';
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

/**
 * One parameter of a visit as the response the point record renders: every stream serving it at
 * the visit is a record, and two of them is a duplicate slot. A finding-only cell has no readings
 * and so no record.
 */
export function cellRecord(detail: EventDetailResponse, parameterId: string): ProvenanceResponse {
	const records = detail.cells
		.filter((c) => c.parameter_id === parameterId)
		.map((c) => c.record)
		.filter((r): r is ProvenanceRecord => r != null);
	return {
		time: detail.collected_at,
		site_id: detail.site_id,
		parameter_id: parameterId,
		duplicate_slot: records.length > 1,
		records,
	};
}

/**
 * What the record marker promises before it is opened: who wrote the value, and how. The marker
 * itself is drawn wherever the row carries a record, so this says only what opening it will show.
 */
export function recordMarkerTitle(row: GridRow): string {
	const parts: string[] = [];
	if (row.tool) parts.push(`written by ${row.tool}`);
	else if (row.provenanceKind) parts.push(row.provenanceKind.replace(/_/g, ' '));
	else if (row.origin) parts.push(row.origin);
	if (row.finding) parts.push(`open finding: ${row.finding.replace(/_/g, ' ')}`);
	return parts.length ? `What produced this value (${parts.join(', ')})` : 'What produced this value';
}
