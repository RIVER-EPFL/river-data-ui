import type { EventDetailResponse, ProvenanceRecord } from '$api/service';

/** A grid position by what it measures: one repeat of one parameter at the visit. */
export interface SlotRef {
	parameterId: string;
	replicateIndex: number;
}

/** What a selected slot is connected to by a calculation, both directions. */
export interface Connections {
	reads: SlotRef[];
	readBy: SlotRef[];
}

/** Which stream each of the visit's cells is served by, so a consumed key resolves to a column. */
function streamParameters(detail: EventDetailResponse): Map<string, string> {
	const out = new Map<string, string>();
	for (const cell of detail.cells) {
		const stream = cell.record?.origin.stream_id ?? cell.stream_id;
		if (stream) out.set(stream, cell.parameter_id);
	}
	return out;
}

/**
 * The slots one record consumed, inside this visit.
 *
 * A member on a stream the visit does not hold, or at another instant, resolves to nothing, which
 * is what keeps a highlight from crossing visits or landing on a same-named parameter elsewhere.
 * An entity input (a constant, a curve, a formula step) has no member and so no slot.
 */
function consumedSlots(
	record: ProvenanceRecord,
	streams: Map<string, string>,
	collectedAt: number,
): SlotRef[] {
	const out: SlotRef[] = [];
	for (const input of record.consumed ?? []) {
		for (const member of input.members ?? []) {
			const parameterId = streams.get(member.stream_id);
			if (!parameterId || Date.parse(member.time) !== collectedAt) continue;
			out.push({ parameterId, replicateIndex: member.replicate_index });
		}
	}
	return unique(out);
}

function unique(slots: SlotRef[]): SlotRef[] {
	const seen = new Set<string>();
	return slots.filter((s) => {
		const key = `${s.parameterId}:${s.replicateIndex}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/**
 * What the slot at `parameterId` is connected to at this visit: the readings its own calculation
 * consumed, and the slots whose calculation consumed one of its readings.
 *
 * Identity is the consumed reading key, never the parameter's label. Two streams serving one
 * parameter are one grid position, so both their records answer for it.
 */
export function connectionsOf(detail: EventDetailResponse, parameterId: string): Connections {
	const streams = streamParameters(detail);
	const at = Date.parse(detail.collected_at);
	const own = detail.cells.filter((c) => c.parameter_id === parameterId);
	const reads = unique(
		own.flatMap((c) => (c.record ? consumedSlots(c.record, streams, at) : [])),
	);
	const readBy: SlotRef[] = [];
	for (const cell of detail.cells) {
		if (cell.parameter_id === parameterId || !cell.record) continue;
		const consumed = consumedSlots(cell.record, streams, at);
		if (!consumed.some((s) => s.parameterId === parameterId)) continue;
		for (const replicate of cell.replicates) {
			readBy.push({ parameterId: cell.parameter_id, replicateIndex: replicate.replicate_index });
		}
		if (cell.replicates.length === 0) {
			readBy.push({ parameterId: cell.parameter_id, replicateIndex: 0 });
		}
	}
	return { reads, readBy: unique(readBy) };
}

/**
 * Whether a highlighted set covers a grid position. A column open to its repeats matches the
 * exact repeat; a collapsed group is one position standing for all of them.
 */
export function covers(
	slots: SlotRef[],
	parameterId: string,
	replicateIndex: number,
	expanded: boolean,
): boolean {
	return slots.some(
		(s) =>
			s.parameterId === parameterId && (!expanded || s.replicateIndex === replicateIndex),
	);
}
