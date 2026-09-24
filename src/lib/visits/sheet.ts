import type { VisitCell, VisitReplicate, VisitRow } from '$api/service';
import { formatMeasurement } from '$lib/format';
import { BROWSER_ZONE } from '$lib/time/zones';
import { formatCompactInstant, zoneLabel } from '$lib/utils';
import type { GridSlot, ParameterColumn } from './columns';
import { readNumber, writeNumber } from './number';
import { spareRow } from './spareRows';
import { cellOf, isSpare, setCell, slotKey, spareId, storedAt, type Edits } from './tableEdit';

// The visit's date stays frozen beside the measurement slots.
export const FROZEN_COLUMNS = 1;

/**
 * The zone the Date column prints and a new row's bare date is read in: the page's, as the header
 * selector names it (undefined for the browser's own).
 */
export function sheetZone(display: string | undefined): string {
	return display ?? BROWSER_ZONE;
}

export type HeaderCell = string | { label: string; colspan: number };

/**
 * Two header rows: the parameter groups across their repeats, then each repeat's number. The date
 * column names the zone its instants are printed in, so the cells stay numeric.
 */
export function sheetHeaders(columns: ParameterColumn[], zone?: string): HeaderCell[][] {
	return [
		['', ...columns.map((c) => ({ label: groupLabel(c), colspan: c.width }))],
		[
			`Date (${zoneLabel(zone)})`,
			...columns.flatMap((c) =>
				c.expanded ? Array.from({ length: c.width }, (_, i) => String(i + 1)) : [''],
			),
		],
	];
}

export function groupLabel(column: ParameterColumn): string {
	return column.units ? `${column.code} (${column.units})` : column.code;
}

/**
 * The rows the grid draws and the columns across them: the visits the store holds, then the spare
 * rows staging new ones. `stored` is where the listing ends and the spare area begins, so a paste
 * running below the drawn rows still names the spare row it would land on.
 */
export interface SheetTable {
	rows: VisitRow[];
	stored: number;
	slots: GridSlot[];
}

/** The row at a grid position, spare rows past the drawn ones included. */
export function rowAt(table: SheetTable, row: number): VisitRow | null {
	if (row < 0) return null;
	if (row < table.rows.length) return table.rows[row];
	if (row < table.stored) return null;
	return spareRow(spareId(row - table.stored));
}

/** What stands at a grid position: the visit, its slot, and what the store holds there. */
export interface SheetSlot {
	visit: VisitRow;
	slot: GridSlot;
	cell: VisitCell | undefined;
	replicate: VisitReplicate | null;
	key: string;
}

export function sheetSlot(table: SheetTable, row: number, column: number): SheetSlot | null {
	const visit = rowAt(table, row);
	const slot = table.slots[column - FROZEN_COLUMNS];
	if (!visit || !slot) return null;
	return {
		visit,
		slot,
		cell: cellOf(visit, slot.parameterId),
		replicate: storedAt(visit, slot.parameterId, slot.replicateIndex),
		key: slotKey({ eventId: visit.id, parameterId: slot.parameterId, replicateIndex: slot.replicateIndex }),
	};
}

/**
 * The number a slot stands for. A slot open to typing holds its replicate; a read-only collapsed
 * group shows what the server serves, which for repeats is their statistic.
 */
export function storedValue(visit: VisitRow, slot: GridSlot, writable: boolean): number | null {
	if (writable || slot.column.expanded) {
		return storedAt(visit, slot.parameterId, slot.replicateIndex)?.value ?? null;
	}
	return cellOf(visit, slot.parameterId)?.value ?? null;
}

/**
 * Every row as text: the frozen date, then what was typed at a slot or its stored value. A spare
 * row's date is whatever was typed into it, which is not an instant until it reads as one.
 */
export function sheetData(
	table: SheetTable,
	edits: Edits,
	dates: Readonly<Record<string, string>>,
	locale: string,
	zone: string | undefined,
	writable: (visit: VisitRow, slot: GridSlot) => boolean,
): string[][] {
	return table.rows.map((visit) => [
		isSpare(visit.id) ? (dates[visit.id] ?? '') : formatCompactInstant(visit.collected_at, zone),
		...table.slots.map((slot) => {
			const key = slotKey({ eventId: visit.id, parameterId: slot.parameterId, replicateIndex: slot.replicateIndex });
			if (key in edits) return edits[key];
			const value = storedValue(visit, slot, writable(visit, slot));
			return value === null ? '' : writeNumber(value, locale);
		}),
	]);
}

/** Each stored visit's date as a value cell names it, formatted once per row rather than per cell. */
export function visitDates(rows: VisitRow[], format: (at: string) => string): Record<string, string> {
	const dates: Record<string, string> = {};
	for (const visit of rows) if (!isSpare(visit.id)) dates[visit.id] = format(visit.collected_at);
	return dates;
}

/**
 * A redraw that runs at most once per frame: every request made before the frame is drawn is
 * served by the one redraw.
 */
export function oncePerFrame(
	draw: () => void,
	schedule: (run: () => void) => unknown = (run) => requestAnimationFrame(run),
): () => void {
	let queued = false;
	return () => {
		if (queued) return;
		queued = true;
		schedule(() => {
			queued = false;
			draw();
		});
	};
}

/** Draw the grid, unless it was torn down before a queued frame reached it. */
export function renderLive(grid: { isDestroyed: boolean; render(): void } | null): void {
	if (grid && !grid.isDestroyed) grid.render();
}

/** What a value cell prints: what was typed, else the stored value at the slot's precision. */
export function displayText(at: SheetSlot, edits: Edits, writable: boolean): string {
	if (at.key in edits) return edits[at.key];
	const value = storedValue(at.visit, at.slot, writable);
	return value === null ? '' : formatMeasurement(value, at.slot.column.decimals);
}

export interface SheetChange {
	row: number;
	column: number;
	raw: string;
}

export interface AppliedChanges {
	edits: Edits;
	/** The date cells of the spare area, by row id. */
	dates: Record<string, string>;
	/** Positions in the change list the grid must not apply. */
	refused: number[];
	unreadable: number;
}

/**
 * A batch of grid changes recorded as typed cells. A listed visit's date takes nothing: its
 * instant is what the store keyed its readings on. A spare row's date takes whatever is typed,
 * because that is the visit it stages. A pasted or filled blank writes no value, because nothing
 * here deletes, and one that cannot be read as a number is left out and counted.
 */
export function applyChanges(
	table: SheetTable,
	edits: Edits,
	dates: Readonly<Record<string, string>>,
	changes: SheetChange[],
	locale: string,
	pasted: boolean,
): AppliedChanges {
	let next = edits;
	let nextDates: Record<string, string> = { ...dates };
	const refused: number[] = [];
	let unreadable = 0;
	changes.forEach((change, index) => {
		const text = change.raw.trim();
		if (change.column < FROZEN_COLUMNS) {
			const row = rowAt(table, change.row);
			if (!row || !isSpare(row.id)) {
				refused.push(index);
				return;
			}
			nextDates = { ...nextDates, [row.id]: text };
			return;
		}
		const at = sheetSlot(table, change.row, change.column);
		if (!at || (pasted && text === '')) {
			refused.push(index);
			return;
		}
		if (text !== '' && readNumber(text, locale) === null) {
			unreadable += 1;
			refused.push(index);
			return;
		}
		next = setCell(next, at.visit, at.slot.parameterId, at.slot.replicateIndex, change.raw, locale);
	});
	return { edits: next, dates: nextDates, refused, unreadable };
}

/**
 * Values in a pasted block that fall past the last column, and so land nowhere. A block running
 * past the last row lands in the spare area, which grows to take it.
 */
export function pasteOverflow(block: string[][], startColumn: number, columns: number): number {
	let overflow = 0;
	block.forEach((line) => {
		line.forEach((raw, dx) => {
			if (raw.trim() !== '' && startColumn + dx >= columns) overflow += 1;
		});
	});
	return overflow;
}
