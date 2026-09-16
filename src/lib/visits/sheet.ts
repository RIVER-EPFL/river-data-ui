import type { VisitCell, VisitReplicate, VisitRow } from '$api/service';
import { formatMeasurement } from '$lib/format';
import type { GridSlot, ParameterColumn } from './columns';
import { readNumber, writeNumber } from './number';
import { setCell, slotKey, storedAt, type Edits } from './tableEdit';

// The Visits table as a spreadsheet grid: the visit's date, source and fill count frozen on the
// left, then one grid column per (parameter, replicate) slot. The grid's cells hold text, which is
// what a copy carries; what a cell prints is decided here from the visit it stands on.

/** Date, source and fill count, ahead of the first slot. */
export const FROZEN_COLUMNS = 3;

export type HeaderCell = string | { label: string; colspan: number };

/** Two header rows: the parameter groups across their repeats, then each repeat's number. */
export function sheetHeaders(columns: ParameterColumn[]): HeaderCell[][] {
	return [
		['', '', '', ...columns.map((c) => ({ label: groupLabel(c), colspan: c.width }))],
		[
			'Date',
			'Source',
			'Filled',
			...columns.flatMap((c) =>
				c.expanded ? Array.from({ length: c.width }, (_, i) => String(i + 1)) : [''],
			),
		],
	];
}

export function groupLabel(column: ParameterColumn): string {
	return column.units ? `${column.code} (${column.units})` : column.code;
}

/** What stands at a grid position: the visit, its slot, and what the store holds there. */
export interface SheetSlot {
	visit: VisitRow;
	slot: GridSlot;
	cell: VisitCell | undefined;
	replicate: VisitReplicate | null;
	key: string;
}

export function sheetSlot(
	visits: VisitRow[],
	slots: GridSlot[],
	row: number,
	column: number,
): SheetSlot | null {
	const visit = visits[row];
	const slot = slots[column - FROZEN_COLUMNS];
	if (!visit || !slot) return null;
	return {
		visit,
		slot,
		cell: visit.cells.find((c) => c.parameter_id === slot.parameterId),
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
	return visit.cells.find((c) => c.parameter_id === slot.parameterId)?.value ?? null;
}

/** Every row as text: the frozen columns, then what was typed at a slot or its stored value. */
export function sheetData(
	visits: VisitRow[],
	slots: GridSlot[],
	edits: Edits,
	locale: string,
	writable: (visit: VisitRow, slot: GridSlot) => boolean,
	formatDate: (iso: string) => string,
): string[][] {
	const parameters = new Set(slots.map((s) => s.parameterId)).size;
	return visits.map((visit) => [
		formatDate(visit.collected_at),
		visit.source === 'portal_sync' ? 'portal' : (visit.created_by ?? 'manual'),
		`${visit.parameters_filled}/${parameters}`,
		...slots.map((slot) => {
			const key = slotKey({ eventId: visit.id, parameterId: slot.parameterId, replicateIndex: slot.replicateIndex });
			if (key in edits) return edits[key];
			const value = storedValue(visit, slot, writable(visit, slot));
			return value === null ? '' : writeNumber(value, locale);
		}),
	]);
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
	/** Positions in the change list the grid must not apply. */
	refused: number[];
	unreadable: number;
}

/**
 * A batch of grid changes recorded as typed cells. The frozen columns take nothing. A pasted or
 * filled blank writes nothing, because nothing here deletes, and a value that cannot be read as a
 * number is left out and counted.
 */
export function applyChanges(
	edits: Edits,
	visits: VisitRow[],
	slots: GridSlot[],
	changes: SheetChange[],
	locale: string,
	pasted: boolean,
): AppliedChanges {
	let next = edits;
	const refused: number[] = [];
	let unreadable = 0;
	changes.forEach((change, index) => {
		const at = sheetSlot(visits, slots, change.row, change.column);
		const text = change.raw.trim();
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
	return { edits: next, refused, unreadable };
}

/** Values in a pasted block that fall past the last row or column, and so land nowhere. */
export function pasteOverflow(
	block: string[][],
	startRow: number,
	startColumn: number,
	rows: number,
	columns: number,
): number {
	let overflow = 0;
	block.forEach((line, dy) => {
		line.forEach((raw, dx) => {
			if (raw.trim() === '') return;
			if (startRow + dy >= rows || startColumn + dx >= columns) overflow += 1;
		});
	});
	return overflow;
}
