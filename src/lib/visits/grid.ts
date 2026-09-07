import type { EventCell, EventDetailResponse, ProvenanceRecord } from '$api/service';
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
	/** The curve the stored replicates were corrected with, shown beside the row, read-only. */
	standardCurveId?: string;
	/** The instrument the row was measured with. Declared per row, defaulting to what the slot
	 *  declares measures this parameter here, and carried onto every value the row enters. */
	sensorId?: string;
	streamId: string;
	/** The assembled record of what produced this value, as the detail already serves it. */
	record?: ProvenanceRecord;
	hasProvenance: boolean;
	/** The row's own recorded origin (`tool_run`, `chain`, `csv_import`, ...). */
	provenanceKind?: string;
	/** The tool that wrote it, when a run did. */
	tool?: string;
	/** How the readings reached the store: manual, csv, api or sync. */
	origin?: string;
	sourceSystem?: string;
	sourceKey?: string;
	/** An open audit finding on this cell, by kind. */
	finding?: string;
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
 * A row for a parameter measured at this visit but never stored here: no replicates yet, and no
 * stream behind it. The grab write path mints the slot's channel on save.
 */
export function addParameterRow(rows: GridRow[], parameter: ConfiguredParameter): GridRow[] {
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
			replicates: [],
			stats: null,
			streamId: '',
			hasProvenance: false,
		},
	];
}

/** The replicates the widest row holds, and never fewer than one. */
export function columnCount(rows: GridRow[]): number {
	return Math.max(1, ...rows.map((r) => r.replicates.length));
}

/**
 * The replicate columns the header draws: one past the widest row, because every row carries one
 * empty cell after its own replicates as the place a further repeat is typed.
 *
 * Rows keep their own widths. A parameter measured once does not draw the four empty inputs its
 * neighbour's five replicates would otherwise impose on it, and tabbing across it crosses one cell
 * rather than five.
 */
export function headerCount(rows: GridRow[]): number {
	return columnCount(rows) + 1;
}

/** Whether the grid draws an input at this position: a row's own replicates, plus one. */
export function isEditable(row: GridRow, column: number): boolean {
	return !row.writtenBy && column <= row.replicates.length;
}

/**
 * Set one cell, growing that row alone to reach it. A row is as wide as the repeats it holds, so
 * typing into its trailing cell is what adds a replicate, and no other row is touched.
 */
export function setCellValue(
	rows: GridRow[],
	rowIndex: number,
	column: number,
	value: number | null,
): GridRow[] {
	return rows.map((row, index) => {
		if (index !== rowIndex || row.writtenBy) return row;
		const replicates = row.replicates.map((c) => ({ ...c }));
		while (replicates.length <= column) replicates.push(emptyCell());
		replicates[column].value = value;
		return { ...row, replicates: trimTrailingGaps(replicates) };
	});
}

/**
 * Drop empty cells off the end of a row, so a value typed and then cleared leaves the row the
 * width it was. A gap between two measured repeats is kept: the index is a position.
 */
function trimTrailingGaps(replicates: GridCell[]): GridCell[] {
	const kept = replicates.slice();
	while (kept.length > 0) {
		const last = kept[kept.length - 1];
		if (last.value !== null || last.stored !== null) break;
		kept.pop();
	}
	return kept;
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
	const ordered = cell.replicates.slice().sort((a, b) => a.replicate_index - b.replicate_index);
	const curve = ordered.find((r) => r.standard_curve_id)?.standard_curve_id;
	// What the stored values already name wins over the slot's current declaration, so re-entering
	// a value does not re-attribute the row to a probe that did not measure it.
	const sensor = ordered.find((r) => r.sensor_id)?.sensor_id;
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
		sensorId: sensor,
		streamId: cell.stream_id,
		record: cell.record ?? undefined,
		hasProvenance: cell.has_provenance,
		provenanceKind: cell.provenance_kind,
		tool: cell.tool,
		origin: cell.origin,
		sourceSystem: cell.source_system,
		sourceKey: cell.source_key,
		finding: cell.finding?.kind,
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
	const next = rows.map((r) => ({ ...r, replicates: r.replicates.map((c) => ({ ...c })) }));
	cells.forEach((line, dy) => {
		const row = next[atRow + dy];
		if (!row || row.writtenBy) return;
		// Only the rows the block covers grow, and each to the width of its own line.
		while (row.replicates.length < atColumn + line.length) row.replicates.push(emptyCell());
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
		row.replicates = trimTrailingGaps(row.replicates);
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
	/** The instrument the row declares it was measured with, null where nothing declares one. */
	sensorId: string | null;
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
				sensorId: row.sensorId ?? null,
			});
		});
	}
	return out;
}

/**
 * The whole replicate group a save posts for each row it enters a new value into.
 *
 * `POST /grab_samples {mode: "replace"}` rewrites every group the request names, so a request
 * carrying only the cells that moved deletes the replicates it did not carry. The group the grid
 * shows is what the store must hold afterwards, so every value on the row travels, corrected cells
 * included: those are written by the decision path first, and repeating them here is what keeps
 * them out of the replace's way.
 */
export function entryGroups(rows: GridRow[]): PendingWrite[] {
	const out: PendingWrite[] = [];
	for (const row of rows) {
		if (row.writtenBy) continue;
		const entering = row.replicates.some(
			(cell) => cell.value !== null && cell.value !== cell.stored && cell.stored === null,
		);
		if (!entering) continue;
		row.replicates.forEach((cell, index) => {
			if (cell.value === null) return;
			out.push({
				parameterId: row.parameterId,
				streamId: row.streamId,
				replicateIndex: index,
				value: cell.value,
				corrects: cell.stored !== null,
				sensorId: row.sensorId ?? null,
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
				sensorId: row.sensorId ?? null,
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
