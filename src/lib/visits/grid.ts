import type { EventCell, EventDetailResponse } from '$api/service';
import { cellRole, type CellRole } from './role';

// The visit as a grid (M50, oriented by I18): one row per parameter, replicate columns beside the
// statistics the trigger maintains. A single visit is the Database grid filtered to one date, so
// the model here is the one a multi-visit block will paste into (M51).

export interface GridCell {
	/** What the field holds now. `null` is a gap: a repeat that was not measured. */
	value: number | null;
	/** What the store holds, so a save writes only what moved and a reset is exact. */
	stored: number | null;
	flagged: boolean;
	withdrawn: boolean;
}

export interface GridRow {
	parameterId: string;
	parameterCode: string;
	parameterName: string;
	role: CellRole;
	roleTitle: string | null;
	roleClass: string;
	/** The calculation that writes this parameter, when one does: the row is read-only then. */
	writtenBy?: string;
	readBy: string[];
	replicates: GridCell[];
	stats: {
		n: number;
		mean?: number;
		stdev?: number;
		min?: number;
		max?: number;
		sd_estimator?: string;
		sd_estimator_source?: string;
	} | null;
	/** The curve the stored replicates were corrected with, shown beside the row. */
	standardCurveId?: string;
	streamId: string;
}

/** A parameter the site is configured for, as the add-parameter control offers it. */
export interface ConfiguredParameter {
	parameterId: string;
	code: string;
	name: string;
}

/** The configured parameters the visit does not hold a row for yet. */
export function addableParameters(
	rows: GridRow[],
	configured: ConfiguredParameter[],
): ConfiguredParameter[] {
	const held = new Set(rows.map((r) => r.parameterId));
	return configured.filter((p) => !held.has(p.parameterId));
}

/**
 * A row for a parameter measured at this visit but never stored here: empty cells as wide as the
 * grid, with no stream behind it. The grab write path mints the slot's channel on save.
 */
export function addParameterRow(rows: GridRow[], parameter: ConfiguredParameter): GridRow[] {
	const width = columnCount(rows);
	return [
		...rows,
		{
			parameterId: parameter.parameterId,
			parameterCode: parameter.code,
			parameterName: parameter.name,
			role: 'plain',
			roleTitle: null,
			roleClass: '',
			readBy: [],
			replicates: Array.from({ length: width }, emptyCell),
			stats: null,
			streamId: '',
		},
	];
}

/** The replicate columns the grid draws: the widest row, and never fewer than one. */
export function columnCount(rows: GridRow[]): number {
	return Math.max(1, ...rows.map((r) => r.replicates.length));
}

function emptyCell(): GridCell {
	return { value: null, stored: null, flagged: false, withdrawn: false };
}

function rowOf(cell: EventCell): GridRow {
	const role = cellRole(cell);
	const highest = cell.replicates.reduce((m, r) => Math.max(m, r.replicate_index), -1);
	const replicates: GridCell[] = Array.from({ length: highest + 1 }, emptyCell);
	for (const r of cell.replicates) {
		replicates[r.replicate_index] = {
			value: r.raw_value,
			stored: r.raw_value,
			flagged: r.flagged,
			withdrawn: r.withdrawn,
		};
	}
	const curve = cell.replicates
		.slice()
		.sort((a, b) => a.replicate_index - b.replicate_index)
		.find((r) => r.standard_curve_id)?.standard_curve_id;
	return {
		parameterId: cell.parameter_id,
		parameterCode: cell.parameter_code,
		parameterName: cell.parameter_name,
		role: role.role,
		roleTitle: role.title,
		roleClass: role.className,
		writtenBy: cell.written_by,
		readBy: cell.read_by ?? [],
		replicates,
		stats: cell.sample
			? {
					n: cell.sample.n,
					mean: cell.sample.mean,
					stdev: cell.sample.stdev,
					min: cell.sample.min,
					max: cell.sample.max,
					sd_estimator: cell.sample.sd_estimator,
					sd_estimator_source: cell.sample.sd_estimator_source,
				}
			: null,
		standardCurveId: curve,
		streamId: cell.stream_id,
	};
}

/** The grid a visit opens as: its stored parameters in the order the detail serves them. */
export function gridFromVisit(detail: EventDetailResponse): GridRow[] {
	return detail.cells.map(rowOf);
}

/** Grow every row to `count` replicate columns, so the grid stays rectangular. */
export function withColumns(rows: GridRow[], count: number): GridRow[] {
	const width = Math.max(1, count);
	return rows.map((row) => {
		const replicates = row.replicates.slice(0, width);
		while (replicates.length < width) replicates.push(emptyCell());
		return { ...row, replicates };
	});
}

/**
 * A spreadsheet block pasted from the focused cell, rightward and downward.
 *
 * Blank cells stay gaps rather than shifting the rest, which is the `replicates` contract: a
 * replicate index is a column position, not an ordinal. The block grows the grid's replicate
 * columns when it is wider than what is drawn, and stops at the last row rather than inventing
 * parameters.
 */
export function applyPaste(
	rows: GridRow[],
	atRow: number,
	atColumn: number,
	block: string,
): GridRow[] {
	const lines = block.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
	const cells = lines.map((line) => line.split('\t'));
	const widest = cells.reduce((m, line) => Math.max(m, line.length), 0);
	const next = withColumns(rows, Math.max(columnCount(rows), atColumn + widest)).map((r) => ({
		...r,
		replicates: r.replicates.map((c) => ({ ...c })),
	}));
	cells.forEach((line, dy) => {
		const row = next[atRow + dy];
		if (!row || row.writtenBy) return;
		line.forEach((raw, dx) => {
			const cell = row.replicates[atColumn + dx];
			if (!cell) return;
			const text = raw.trim();
			if (text === '') {
				cell.value = null;
				return;
			}
			const parsed = Number(text);
			cell.value = Number.isNaN(parsed) ? cell.value : parsed;
		});
	});
	return next;
}

/** One cell a save has to write, and whether the store already holds a reading at that key. */
export interface PendingWrite {
	parameterId: string;
	streamId: string;
	replicateIndex: number;
	value: number;
	/** True when a reading is stored at the key, so the write is a correction, not an entry. */
	corrects: boolean;
	/** The lab curve the row is read against, carried onto every value it enters. */
	standardCurveId: string | null;
}

/**
 * What a save would write: every cell whose value moved. A cell that was cleared is not a write,
 * because nothing here deletes: withdrawing a stored replicate is a decision taken on the row.
 */
export function pendingWrites(rows: GridRow[]): PendingWrite[] {
	const out: PendingWrite[] = [];
	for (const row of rows) {
		if (row.writtenBy) continue;
		row.replicates.forEach((cell, index) => {
			if (cell.value === null || cell.value === cell.stored) return;
			out.push({
				parameterId: row.parameterId,
				streamId: row.streamId,
				replicateIndex: index,
				value: cell.value,
				corrects: cell.stored !== null,
				standardCurveId: row.standardCurveId ?? null,
			});
		});
	}
	return out;
}

/** Cells the operator cleared that the store still holds: named, never silently dropped. */
export function clearedCells(rows: GridRow[]): PendingWrite[] {
	const out: PendingWrite[] = [];
	for (const row of rows) {
		if (row.writtenBy) continue;
		row.replicates.forEach((cell, index) => {
			if (cell.value !== null || cell.stored === null) return;
			out.push({
				parameterId: row.parameterId,
				streamId: row.streamId,
				replicateIndex: index,
				value: cell.stored,
				corrects: true,
				standardCurveId: row.standardCurveId ?? null,
			});
		});
	}
	return out;
}

/** The parameters a save touches, for the closure that says what recomputes. */
export function touchedParameters(rows: GridRow[]): string[] {
	return [...new Set(pendingWrites(rows).map((w) => w.parameterId))];
}

/**
 * The staged visit a grid row's calculation is opened at: the tool page reads its context from the
 * store, so opening a computation from the grid means staging exactly the visit being read.
 */
export function stagedVisitFrom(
	detail: { id: string; site_id: string; collected_at: string },
	siteName: string,
): { eventId: string; siteId: string; siteName: string; collectedAt: string } {
	return {
		eventId: detail.id,
		siteId: detail.site_id,
		siteName,
		collectedAt: detail.collected_at,
	};
}
