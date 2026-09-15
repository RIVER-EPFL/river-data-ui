import type { VisitReplicate, VisitRow } from '$api/service';
import type { GridSlot, ParameterColumn } from './columns';
import { readNumber } from './number';

// Typing into the Visits table. A row is a visit and a column is one (parameter, replicate) slot,
// the transpose of the per-visit grid, and one Save writes every visit the table has touched.
//
// What a cell takes is the whole model: a value the store already holds is a correction, keyed on
// the stream the replicate came in on; a slot the visit never held is an entry, and an entry
// rewrites its whole replicate group, so the group's other values travel with it.

export interface SlotKey {
	eventId: string;
	parameterId: string;
	replicateIndex: number;
}

export function slotKey(slot: SlotKey): string {
	return `${slot.eventId}|${slot.parameterId}|${slot.replicateIndex}`;
}

/** What the operator has typed, by slot. Everything not in here is what the server sent. */
export type Edits = Record<string, string>;

export function storedAt(
	visit: VisitRow,
	parameterId: string,
	replicateIndex: number,
): VisitReplicate | null {
	const cell = visit.cells.find((c) => c.parameter_id === parameterId);
	return cell?.replicates?.find((r) => r.replicate_index === replicateIndex) ?? null;
}

/**
 * Whether the column takes a keystroke. A collapsed group of repeats shows the mean of them, which
 * is not a number anybody can type: open it to its replicates first.
 */
export function editable(column: ParameterColumn): boolean {
	return column.expanded || column.repeats === 1;
}

/** The text a slot shows: what was typed there, else the stored value. */
export function cellText(
	edits: Edits,
	visit: VisitRow,
	parameterId: string,
	replicateIndex: number,
	format: (value: number) => string,
): string {
	const key = slotKey({ eventId: visit.id, parameterId, replicateIndex });
	if (key in edits) return edits[key];
	const stored = storedAt(visit, parameterId, replicateIndex);
	return stored ? format(stored.value) : '';
}

/**
 * Record one typed cell. Typing the stored value back, or clearing a cell the store holds nothing
 * at, leaves nothing to save, so the edit is dropped rather than kept as a no-op write.
 */
export function setCell(
	edits: Edits,
	visit: VisitRow,
	parameterId: string,
	replicateIndex: number,
	raw: string,
	locale: string,
): Edits {
	const key = slotKey({ eventId: visit.id, parameterId, replicateIndex });
	const stored = storedAt(visit, parameterId, replicateIndex);
	const typed = readNumber(raw, locale);
	const next = { ...edits };
	if (typed === null ? stored === null : typed === stored?.value) delete next[key];
	else next[key] = raw;
	return next;
}

export interface Correction {
	parameterId: string;
	streamId: string;
	replicateIndex: number;
	value: number;
}

export interface Entry {
	parameterId: string;
	replicateIndex: number;
	value: number;
	/** The instrument the group declares it was measured with, null where nothing declares one. */
	sensorId: string | null;
}

/** What one visit's Save writes: corrections keyed on their stream, entries as whole groups. */
export interface VisitWrite {
	eventId: string;
	collectedAt: string;
	corrections: Correction[];
	entries: Entry[];
}

/**
 * The writes the table's Save makes, one entry per visit it touched, in the table's own order.
 *
 * A correction names the stream its replicate came in on, which is what the edit primitive keys
 * on. An entry rewrites its replicate group, so every value of a group being entered into travels
 * with it, corrected cells included: `mode: "replace"` drops what the request does not carry.
 * A cleared cell is not a write, because nothing here deletes.
 */
export function pendingWrites(
	visits: VisitRow[],
	edits: Edits,
	locale: string,
	instruments: Readonly<Record<string, string>> = {},
): VisitWrite[] {
	const writes: VisitWrite[] = [];
	for (const visit of visits) {
		const corrections: Correction[] = [];
		const entered = new Set<string>();
		for (const [key, raw] of Object.entries(edits)) {
			const [eventId, parameterId, index] = key.split('|');
			if (eventId !== visit.id) continue;
			const value = readNumber(raw, locale);
			if (value === null) continue;
			const stored = storedAt(visit, parameterId, Number(index));
			if (stored) {
				corrections.push({
					parameterId,
					streamId: stored.stream_id,
					replicateIndex: stored.replicate_index,
					value,
				});
			} else {
				entered.add(parameterId);
			}
		}
		const entries =
			entered.size > 0 ? groupsOf(visit, edits, entered, locale, instruments) : [];
		if (corrections.length > 0 || entries.length > 0) {
			writes.push({
				eventId: visit.id,
				collectedAt: visit.collected_at,
				corrections,
				entries,
			});
		}
	}
	return writes;
}

/** Every value of each group being entered into: what the store must hold after the replace. */
function groupsOf(
	visit: VisitRow,
	edits: Edits,
	parameters: ReadonlySet<string>,
	locale: string,
	instruments: Readonly<Record<string, string>>,
): Entry[] {
	const entries: Entry[] = [];
	for (const parameterId of parameters) {
		const sensorId = instruments[`${visit.id}|${parameterId}`] ?? null;
		const cell = visit.cells.find((c) => c.parameter_id === parameterId);
		const indexes = new Set<number>((cell?.replicates ?? []).map((r) => r.replicate_index));
		for (const key of Object.keys(edits)) {
			const [eventId, parameter, index] = key.split('|');
			if (eventId === visit.id && parameter === parameterId) indexes.add(Number(index));
		}
		for (const replicateIndex of [...indexes].sort((a, b) => a - b)) {
			const key = slotKey({ eventId: visit.id, parameterId, replicateIndex });
			const typed = key in edits ? readNumber(edits[key], locale) : null;
			const stored = storedAt(visit, parameterId, replicateIndex);
			const value = typed ?? stored?.value ?? null;
			if (value !== null) entries.push({ parameterId, replicateIndex, value, sensorId });
		}
	}
	return entries;
}

/**
 * How many cells moved, which is what the Save label counts. Not the size of the payload: a group
 * being entered into carries its untouched values too, and those are not edits.
 */
export function pendingCount(edits: Edits, locale: string): number {
	return Object.values(edits).filter((raw) => readNumber(raw, locale) !== null).length;
}

/**
 * The replicate indices the table believed the store held, per group being entered into. The
 * replace reports back what it kept and what it retracted against this, so a curated value the
 * table could not write is named rather than silently dropped.
 */
export function expectedReplicates(
	visit: VisitRow,
	entries: Entry[],
): { parameter_id: string; time: string; replicate_indices: number[] }[] {
	const named = new Set(entries.map((entry) => entry.parameterId));
	return [...named].map((parameterId) => ({
		parameter_id: parameterId,
		time: visit.collected_at,
		replicate_indices: (
			visit.cells.find((c) => c.parameter_id === parameterId)?.replicates ?? []
		).map((r) => r.replicate_index),
	}));
}

/** The key an instrument declaration is held under: one per (visit, parameter) group. */
export function instrumentKey(eventId: string, parameterId: string): string {
	return `${eventId}|${parameterId}`;
}

/** The pairs a visit's check has to cover: the entry half of its save, which is what is screened. */
export function entryValues(write: VisitWrite): { parameter_id: string; value: number }[] {
	return write.entries.map((e) => ({ parameter_id: e.parameterId, value: e.value }));
}

/**
 * What a visit's screening was run against. A save naming a check is held by the server to exactly
 * the values it screened, so any edit to that visit's entries re-arms the gate.
 */
export function checkSignature(write: VisitWrite): string {
	return `${write.eventId}|${JSON.stringify(entryValues(write))}`;
}

/** Whether every visit entering a value has a current screening behind it. */
export function checkSatisfied(
	writes: VisitWrite[],
	checks: Record<string, { id: string; signature: string }>,
): boolean {
	return writes
		.filter((w) => w.entries.length > 0)
		.every((w) => checks[w.eventId]?.signature === checkSignature(w));
}

/** Every correction across the table, as the edit primitive's selection keys. */
export function correctionKeys(
	writes: VisitWrite[],
): { stream_id: string; time: string; replicate_index: number; value: number }[] {
	return writes.flatMap((write) =>
		write.corrections.map((c) => ({
			stream_id: c.streamId,
			time: write.collectedAt,
			replicate_index: c.replicateIndex,
			value: c.value,
		})),
	);
}

/**
 * A selected block copied out, in the table's own row order, which is date order. Tab-separated
 * and newline-terminated, the layout a spreadsheet gives back on a paste.
 */
export function copyBlock(
	visits: VisitRow[],
	slots: GridSlot[],
	edits: Edits,
	block: { row: number; column: number; height: number; width: number },
	format: (value: number) => string,
): string {
	const lines: string[] = [];
	for (let dy = 0; dy < block.height; dy += 1) {
		const visit = visits[block.row + dy];
		if (!visit) break;
		const line: string[] = [];
		for (let dx = 0; dx < block.width; dx += 1) {
			const slot = slots[block.column + dx];
			if (!slot) break;
			line.push(cellText(edits, visit, slot.parameterId, slot.replicateIndex, format));
		}
		lines.push(line.join('\t'));
	}
	return lines.join('\n');
}

export interface TablePaste {
	edits: Edits;
	/** Cells the block covered that could not be read as a number. */
	unreadable: number;
	/** Values that ran past the last listed visit or the last column, and landed nowhere. */
	overflow: number;
}

/**
 * A spreadsheet block pasted at a cell, down the visits listed below it and across the slots to
 * its right.
 *
 * The table lists dates, so a column of a month's readings lands one per visit in the order they
 * are listed. A block running past the last listed visit is not a visit to create: those values
 * are counted and dropped, and the operator adds the dates first. A blank cell writes nothing,
 * because nothing here deletes.
 */
export function applyPaste(
	visits: VisitRow[],
	slots: GridSlot[],
	edits: Edits,
	atRow: number,
	atColumn: number,
	block: string,
	locale: string,
): TablePaste {
	const lines = block
		.replace(/\r\n?/g, '\n')
		.replace(/\n+$/, '')
		.split('\n')
		.map((line) => line.split('\t'));
	let next = edits;
	let unreadable = 0;
	let overflow = 0;
	lines.forEach((line, dy) => {
		const visit = visits[atRow + dy];
		line.forEach((raw, dx) => {
			const slot = slots[atColumn + dx];
			const text = raw.trim();
			if (!visit || !slot) {
				if (text !== '') overflow += 1;
				return;
			}
			if (text === '') return;
			if (readNumber(text, locale) === null) {
				unreadable += 1;
				return;
			}
			next = setCell(next, visit, slot.parameterId, slot.replicateIndex, text, locale);
		});
	});
	return { edits: next, unreadable, overflow };
}

/** What a paste left behind, said in one line rather than passed as a toast that scrolls away. */
export function pasteNotice(paste: TablePaste): string | null {
	const notes: string[] = [];
	if (paste.unreadable > 0) {
		notes.push(
			`${paste.unreadable} cell${paste.unreadable === 1 ? '' : 's'} could not be read as a number and ${paste.unreadable === 1 ? 'was' : 'were'} left alone`,
		);
	}
	if (paste.overflow > 0) {
		notes.push(
			`${paste.overflow} value${paste.overflow === 1 ? '' : 's'} ran past the visits listed; add the dates first`,
		);
	}
	return notes.length > 0 ? `${notes.join('. ')}.` : null;
}
