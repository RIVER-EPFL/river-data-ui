import type { VisitReplicate, VisitRow } from '$api/service';
import type { ParameterColumn } from './columns';
import { readNumber } from './number';

// Typing into the Visits table. A row is a visit and a column is one (parameter, replicate) slot,
// the transpose of the per-visit grid, and one Save writes every visit the table has touched.
//
// What a cell takes is the whole model: a value the store already holds is a correction, keyed on
// the stream the replicate came in on; a slot the visit never held is an entry, and an entry
// rewrites its whole replicate group, so the group's other values travel with it. A blank on a
// stored cell withdraws the replicate (Q227), reversibly: nothing here deletes.

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

const SPARE_PREFIX = 'new:';

/** The id a row of the spare area is keyed under while it has no visit of its own. */
export function spareId(index: number): string {
	return `${SPARE_PREFIX}${index}`;
}

export function isSpare(eventId: string): boolean {
	return eventId.startsWith(SPARE_PREFIX);
}

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
 * is not a number anybody can type: open it to its replicates first. A column a calculation writes
 * holds computed values, corrected by running the calculation again (Q8), so it takes none either.
 */
export function editable(column: ParameterColumn): boolean {
	if (column.writtenBy) return false;
	return column.expanded || column.repeats === 1;
}

/** A blank typed over a cell, as opposed to text that could not be read as a number. */
export function cleared(raw: string): boolean {
	return raw.trim() === '';
}

/**
 * Record one typed cell. Typing the stored value back, or clearing a cell the store holds nothing
 * at, leaves nothing to save, so the edit is dropped rather than kept as a no-op write. A blank
 * on a stored cell is kept: it is the replicate's withdrawal.
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

/** A stored replicate the operator cleared, keyed like a correction. */
export interface Withdrawal {
	parameterId: string;
	streamId: string;
	replicateIndex: number;
}

/**
 * What one visit's Save writes: corrections and withdrawals keyed on their stream, entries as
 * whole groups.
 */
export interface VisitWrite {
	eventId: string;
	collectedAt: string;
	corrections: Correction[];
	withdrawals: Withdrawal[];
	entries: Entry[];
}

/**
 * The writes the table's Save makes, one entry per visit it touched, in the table's own order.
 *
 * A correction names the stream its replicate came in on, which is what the edit primitive keys
 * on. An entry rewrites its replicate group, so every value of a group being entered into travels
 * with it, corrected cells included: `mode: "replace"` drops what the request does not carry, and
 * retracts it. A cleared stored cell in such a group is therefore left out of the entries; one in
 * any other group is a withdrawal of its own.
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
		const blanks: Withdrawal[] = [];
		const entered = new Set<string>();
		for (const [key, raw] of Object.entries(edits)) {
			const [eventId, parameterId, index] = key.split('|');
			if (eventId !== visit.id) continue;
			const value = readNumber(raw, locale);
			const stored = storedAt(visit, parameterId, Number(index));
			if (value === null) {
				if (stored && cleared(raw)) {
					blanks.push({
						parameterId,
						streamId: stored.stream_id,
						replicateIndex: stored.replicate_index,
					});
				}
				continue;
			}
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
		const withdrawals = blanks.filter((b) => !entered.has(b.parameterId));
		const entries =
			entered.size > 0 ? groupsOf(visit, edits, entered, locale, instruments) : [];
		if (corrections.length > 0 || withdrawals.length > 0 || entries.length > 0) {
			writes.push({
				eventId: visit.id,
				collectedAt: visit.collected_at,
				corrections,
				withdrawals,
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
			const value = groupValue(edits[key], storedAt(visit, parameterId, replicateIndex), locale);
			if (value !== null) entries.push({ parameterId, replicateIndex, value, sensorId });
		}
	}
	return entries;
}

/** What a group carries at one slot: the number typed, nothing where it was cleared, else the store's. */
function groupValue(raw: string | undefined, stored: VisitReplicate | null, locale: string): number | null {
	if (raw === undefined) return stored?.value ?? null;
	if (cleared(raw)) return null;
	return readNumber(raw, locale) ?? stored?.value ?? null;
}

/**
 * How many cells moved, which is what the Save label counts. Not the size of the payload: a group
 * being entered into carries its untouched values too, and those are not edits. A cleared cell
 * moved.
 */
export function pendingCount(edits: Edits, locale: string): number {
	return Object.values(edits).filter((raw) => cleared(raw) || readNumber(raw, locale) !== null)
		.length;
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

/** Every withdrawal across the table, as the edit primitive's selection keys. */
export function withdrawalKeys(
	writes: VisitWrite[],
): { stream_id: string; time: string; replicate_index: number }[] {
	return writes.flatMap((write) =>
		write.withdrawals.map((w) => ({
			stream_id: w.streamId,
			time: write.collectedAt,
			replicate_index: w.replicateIndex,
		})),
	);
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

export interface TablePaste {
	edits: Edits;
	/** Cells the block covered that could not be read as a number. */
	unreadable: number;
	/** Values that ran past the last column, and so landed nowhere. */
	overflow: number;
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
			`${paste.overflow} value${paste.overflow === 1 ? '' : 's'} ran past the columns listed and ${paste.overflow === 1 ? 'was' : 'were'} not read`,
		);
	}
	return notes.length > 0 ? `${notes.join('. ')}.` : null;
}
