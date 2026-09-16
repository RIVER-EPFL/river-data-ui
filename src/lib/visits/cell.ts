import type {
	EventCell,
	EventDetailResponse,
	ExpectedParameter,
	ProvenanceRecord,
	ProvenanceResponse,
	VisitCell,
} from '$api/service';
import { formatMeasurement } from '$lib/format';

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
	const pending = cell.n_unverified > 0;
	if (!flagged && !withdrawn && !pending) return null;
	const parts: string[] = [];
	if (flagged) parts.push(`${cell.n_flagged || cell.n_total} of ${cell.n_total} flagged`);
	if (withdrawn) parts.push(`${cell.n_withdrawn || cell.n_total} of ${cell.n_total} withdrawn at source`);
	if (pending) parts.push(`${cell.n_unverified} of ${cell.n_total} entered and not yet verified`);
	const excluded = cell.flagged || cell.withdrawn ? 'nothing is served' : 'the mean excludes them';
	return {
		text: `${flagged ? '*' : ''}${withdrawn ? '†' : ''}${pending ? '?' : ''}`,
		title: `${parts.join(', ')}: ${excluded}`,
	};
}

/** What a statistics line reads, present on both the wide row and the expanded cell's sample. */
export interface StatisticsGroup {
	n?: number;
	stdev?: number;
	median?: number;
	min?: number;
	max?: number;
}

/**
 * The statistics a group carries, one part per fact: how many vials and how far apart they were.
 * The sd is the sample sd (n-1).
 */
export function statisticsParts(
	group: StatisticsGroup,
	decimals?: number | null,
	units?: string | null
): string[] {
	if (group.n == null || group.n < 1) return [];
	const fmt = (v: number | null | undefined) =>
		v == null ? null : formatMeasurement(v, decimals);
	const unit = units ? ` ${units}` : '';
	const parts = [`n = ${group.n}`];
	const sd = fmt(group.stdev);
	if (sd != null) parts.push(`SD ${sd}${unit}`);
	const median = fmt(group.median);
	if (median != null) parts.push(`median ${median}${unit}`);
	const min = fmt(group.min);
	const max = fmt(group.max);
	if (min != null && max != null) parts.push(`range ${min} to ${max}${unit}`);
	return parts;
}

/** The statistics line a grid cell carries on hover. */
export function visitCellStatistics(
	cell: VisitCell,
	decimals?: number | null,
	units?: string | null
): string | null {
	const parts = statisticsParts(cell, decimals, units);
	// A pending group has statistics of nothing: the trigger counts no unverified replicate, so
	// the line says that rather than disappearing beside values that are on screen.
	if (!parts.length && cell.n_unverified > 0)
		return `n = 0: ${cell.n_unverified} pending ${cell.n_unverified === 1 ? 'value is' : 'values are'} not counted until verified`;
	return parts.length ? parts.join(' · ') : null;
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

/** An audit finding, in the word the operator reads on the cell. */
export function findingLabel(kind: string): string {
	switch (kind) {
		case 'stale_output':
			return 'stale';
		case 'skipped_output':
			return 'skipped';
		default:
			return 'missing';
	}
}

/** A line of the expanded record: a parameter, and the readings the visit holds for it. */
export interface RecordRow {
	parameterId: string;
	parameterName: string;
	/** `null` when the visit holds nothing for the slot: the site declares it, nobody measured it. */
	cell: EventCell | null;
}

/**
 * The expanded record's rows: every parameter the site expects, whether or not the visit measured
 * it, followed by anything the visit holds that the site no longer expects. A slot with no reading
 * still has a row, so a first measurement can declare what took it (U69).
 *
 * Two streams serving one parameter are two rows, as they are in the table above.
 */
export function recordRows(cells: EventCell[], expected: ExpectedParameter[]): RecordRow[] {
	const held = new Map<string, EventCell[]>();
	for (const cell of cells) {
		const kept = held.get(cell.parameter_id);
		if (kept) kept.push(cell);
		else held.set(cell.parameter_id, [cell]);
	}
	const rowOf = (cell: EventCell): RecordRow => ({
		parameterId: cell.parameter_id,
		parameterName: cell.parameter_name,
		cell,
	});
	const declared = expected.flatMap((p) => {
		const own = held.get(p.parameter_id);
		if (own) return own.map(rowOf);
		return [{ parameterId: p.parameter_id, parameterName: p.name, cell: null }];
	});
	const unexpected = cells
		.filter((c) => !expected.some((p) => p.parameter_id === c.parameter_id))
		.map(rowOf);
	return [...declared, ...unexpected];
}
