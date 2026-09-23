import type { EventPreview, StagedCell, VisitRow } from '$api/service';
import type { GridSlot } from './columns';
import { readNumber } from './number';
import { cleared, isSpare, storedAt, type Edits } from './tableEdit';

// What the calculations would say, given what the operator has typed and not saved. The server
// runs the same chain the Save runs and stores none of it (Q212); this decides which visits to ask
// about, what to ask, which answer is still the latest, and what each grid cell shows.

/** The staged cells one visit's typed cells amount to, lowest slot first. */
export function stagedCells(visit: VisitRow, edits: Edits, locale: string): StagedCell[] {
	const cells: StagedCell[] = [];
	for (const [key, raw] of Object.entries(edits)) {
		const [eventId, parameterId, index] = key.split('|');
		if (eventId !== visit.id) continue;
		const replicateIndex = Number(index);
		const value = readNumber(raw, locale);
		if (value === null) {
			// A blank over a stored value is that replicate's withdrawal, and the calculation reads
			// the visit without it. A blank over a cell the store holds nothing at cancels the entry,
			// and text that is not a number says nothing at all.
			if (!cleared(raw) || !storedAt(visit, parameterId, replicateIndex)) continue;
			cells.push({ parameter_id: parameterId, replicate_index: replicateIndex, value: null });
		} else {
			cells.push({ parameter_id: parameterId, replicate_index: replicateIndex, value });
		}
	}
	return cells.sort((a, b) =>
		a.parameter_id === b.parameter_id
			? a.replicate_index - b.replicate_index
			: a.parameter_id.localeCompare(b.parameter_id),
	);
}

/** One visit's ask: what to send, and the signature that says whether it is still the latest. */
export interface PreviewAsk {
	eventId: string;
	/** A spare row's instant: it has no visit yet, so it is asked at its site and this instant. */
	at?: string;
	cells: StagedCell[];
	signature: string;
}

export function signatureOf(cells: StagedCell[]): string {
	return cells.map((c) => `${c.parameter_id}:${c.replicate_index}:${c.value ?? ''}`).join(',');
}

/**
 * The visits worth asking about: those the operator has typed a readable change into. A visit the
 * table only shows, or one whose every typed cell is unreadable, asks nothing.
 *
 * A row of the spare area has no visit yet, so it is asked at the instant its date names, and a row
 * naming no date asks nothing.
 */
export function previewAsks(visits: VisitRow[], edits: Edits, locale: string): PreviewAsk[] {
	const asks: PreviewAsk[] = [];
	for (const visit of visits) {
		const spare = isSpare(visit.id);
		if (spare && !visit.collected_at) continue;
		const cells = stagedCells(visit, edits, locale);
		if (cells.length === 0) continue;
		const signature = signatureOf(cells);
		asks.push(
			spare
				? {
						eventId: visit.id,
						at: visit.collected_at,
						cells,
						signature: `${visit.collected_at}|${signature}`,
					}
				: { eventId: visit.id, cells, signature },
		);
	}
	return asks;
}

/** What a preview reported for one visit, and where that visit stands. */
export interface VisitPreview {
	/** The ask this answers, so a response that arrives after a later one is dropped. */
	signature: string;
	state: 'pending' | 'ready' | 'error';
	/** The previewed value at `${parameterId}|${replicateIndex}`; null where the slot is cleared. */
	values: Record<string, number | null>;
	/** Calculations that did not run, as one line each. */
	skipped: string[];
	message: string | null;
}

export type Previews = Record<string, VisitPreview>;

export function valuesOf(preview: EventPreview): Record<string, number | null> {
	const values: Record<string, number | null> = {};
	for (const o of preview.outputs ?? []) {
		values[`${o.parameter_id}|${o.replicate_index ?? 0}`] = o.value ?? null;
	}
	return values;
}

export function skippedOf(preview: EventPreview): string[] {
	return (preview.skipped ?? []).map(([tool, reason]) => `${tool}: ${reason}`);
}

/**
 * The previewed value a grid cell shows, or `undefined` where the preview says nothing about it.
 *
 * An open group shows the repeat at its own index. A collapsed group shows what the slot would
 * serve, which is the statistic over the repeats the preview produced: their mean where it
 * produced two or more, the value itself where it produced one. A cleared slot previews a blank.
 */
export function previewedAt(
	preview: VisitPreview | undefined,
	slot: GridSlot,
): number | null | undefined {
	if (!preview || preview.state !== 'ready') return undefined;
	if (slot.column.expanded) return preview.values[`${slot.parameterId}|${slot.replicateIndex}`];
	const repeats = Object.entries(preview.values)
		.filter(([key]) => key.startsWith(`${slot.parameterId}|`))
		.map(([, value]) => value);
	if (repeats.length === 0) return undefined;
	const live = repeats.filter((v): v is number => v !== null);
	if (live.length === 0) return null;
	return live.reduce((sum, v) => sum + v, 0) / live.length;
}

/**
 * The asks worth sending: those whose visit has no answer to this exact ask already. Typing a value
 * back to what it was asks nothing again.
 */
export function unanswered(previews: Previews, asks: PreviewAsk[]): PreviewAsk[] {
	return asks.filter((a) => previews[a.eventId]?.signature !== a.signature);
}

/**
 * The previews as they stand once these asks are in flight: a visit nobody is typing into any more
 * keeps no previewed value, and a visit whose ask has changed goes back to pending rather than
 * leaving the last answer standing as though it were about what is on the screen now.
 */
export function asking(previews: Previews, asks: PreviewAsk[]): Previews {
	const next: Previews = {};
	for (const ask of asks) {
		const standing = previews[ask.eventId];
		next[ask.eventId] =
			standing?.signature === ask.signature
				? standing
				: { signature: ask.signature, state: 'pending', values: {}, skipped: [], message: null };
	}
	return next;
}

/**
 * Take an answer, unless the operator has typed past the ask it answers: a response that arrives
 * after a later one is about a grid that no longer exists, and drawing it would show the operator
 * numbers from a draft they have left behind.
 */
export function settled(previews: Previews, ask: PreviewAsk, answer: EventPreview): Previews {
	if (previews[ask.eventId]?.signature !== ask.signature) return previews;
	return {
		...previews,
		[ask.eventId]: {
			signature: ask.signature,
			state: 'ready',
			values: valuesOf(answer),
			skipped: skippedOf(answer),
			message: null,
		},
	};
}

/** The same, for an ask that did not answer at all. */
export function failed(previews: Previews, ask: PreviewAsk, message: string): Previews {
	if (previews[ask.eventId]?.signature !== ask.signature) return previews;
	return {
		...previews,
		[ask.eventId]: {
			signature: ask.signature,
			state: 'error',
			values: {},
			skipped: [],
			message,
		},
	};
}

/**
 * The line beside Save: what the previewed cells are and whether they can be trusted yet. Null
 * when nothing has been typed that a calculation reads.
 */
export function previewNotice(previews: Previews): string | null {
	const entries = Object.values(previews);
	if (entries.length === 0) return null;
	if (entries.some((p) => p.state === 'pending')) return 'Calculating what these values give…';
	const failed = entries.find((p) => p.state === 'error');
	if (failed) {
		return `The calculated values could not be worked out: ${failed.message ?? 'the preview did not run'}`;
	}
	const cells = entries.reduce((n, p) => n + Object.keys(p.values).length, 0);
	if (cells === 0) return null;
	const skipped = [...new Set(entries.flatMap((p) => p.skipped))];
	const line = `${cells} calculated ${cells === 1 ? 'value' : 'values'} shown unsaved; Save writes them.`;
	return skipped.length > 0 ? `${line} Not run: ${skipped.join('; ')}` : line;
}
