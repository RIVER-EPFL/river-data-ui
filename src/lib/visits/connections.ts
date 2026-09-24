import type { EventDetailResponse, ProvenanceRecord } from '$api/service';
import type { ParameterColumn } from './columns';

/** A grid position by what it measures: one repeat of one parameter at the visit, or every repeat
 * of it where `replicateIndex` is null. */
export interface SlotRef {
	parameterId: string;
	replicateIndex: number | null;
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

/** The columns a portal calculation read, by the stream carrying each at this site. The source
 * names no repeat, so each input stands for its whole group. */
function portalSlots(record: ProvenanceRecord, streams: Map<string, string>): SlotRef[] {
	const out: SlotRef[] = [];
	for (const input of record.origin.portal_calculation?.inputs ?? []) {
		const parameterId = input.stream_id ? streams.get(input.stream_id) : undefined;
		if (parameterId) out.push({ parameterId, replicateIndex: null });
	}
	return unique(out);
}

/** Every slot a record's calculation read at this visit: a stored run's members, a portal's inputs. */
function readSlots(record: ProvenanceRecord, streams: Map<string, string>, collectedAt: number): SlotRef[] {
	return unique([...consumedSlots(record, streams, collectedAt), ...portalSlots(record, streams)]);
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
 * What a column is connected to by the calculations the site declares, at any visit: the columns
 * the calculation writing it reads, and the columns written by the calculations reading it. Every
 * repeat of each, since a declaration names parameters, not readings.
 */
export function declaredConnections(columns: ParameterColumn[], parameterId: string): Connections {
	const own = columns.find((c) => c.parameterId === parameterId);
	if (!own) return { reads: [], readBy: [] };
	const whole = (c: ParameterColumn): SlotRef => ({ parameterId: c.parameterId, replicateIndex: null });
	const others = columns.filter((c) => c.parameterId !== parameterId);
	const writer = own.writtenBy;
	return {
		reads: writer ? others.filter((c) => c.readBy.includes(writer)).map(whole) : [],
		readBy: others.filter((c) => c.writtenBy !== null && own.readBy.includes(c.writtenBy)).map(whole),
	};
}

/**
 * The declared connections, with each parameter the stored ones name narrowed to the repeats
 * they name. A stored connection the declaration does not carry is kept.
 */
export function mergedConnections(declared: Connections, stored: Connections): Connections {
	const merge = (whole: SlotRef[], exact: SlotRef[]) => {
		const named = new Set(exact.map((s) => s.parameterId));
		return unique([...whole.filter((s) => !named.has(s.parameterId)), ...exact]);
	};
	return { reads: merge(declared.reads, stored.reads), readBy: merge(declared.readBy, stored.readBy) };
}

/**
 * What the slot at `parameterId` is connected to at this visit: the readings its own calculation
 * read, and the slots whose calculation read one of its readings.
 *
 * Identity is the stream a reading was read from, never the parameter's label. Two streams serving one
 * parameter are one grid position, so both their records answer for it.
 */
export function connectionsOf(detail: EventDetailResponse, parameterId: string): Connections {
	const streams = streamParameters(detail);
	const at = Date.parse(detail.collected_at);
	const own = detail.cells.filter((c) => c.parameter_id === parameterId);
	const reads = unique(
		own.flatMap((c) => (c.record ? readSlots(c.record, streams, at) : [])),
	);
	const readBy: SlotRef[] = [];
	for (const cell of detail.cells) {
		if (cell.parameter_id === parameterId || !cell.record) continue;
		const consumed = readSlots(cell.record, streams, at);
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
 * exact repeat, or any repeat of a whole-group slot; a collapsed group is one position standing
 * for all of them.
 */
export function covers(
	slots: SlotRef[],
	parameterId: string,
	replicateIndex: number,
	expanded: boolean,
): boolean {
	return slots.some(
		(s) =>
			s.parameterId === parameterId &&
			(!expanded || s.replicateIndex === null || s.replicateIndex === replicateIndex),
	);
}
