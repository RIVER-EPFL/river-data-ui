import { apiMessage } from '$lib/standardCurves';

/** What a parameter is doing inside its group; the server holds the same three values. */
export const MEMBER_ROLES = ['measured', 'entry_only', 'output'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/** A group as far as message rendering is concerned. */
export interface NamedGroup {
	id: string;
	code: string;
	label: string;
}

export function roleLabel(role: string): string {
	switch (role) {
		case 'measured':
			return 'Measured';
		case 'entry_only':
			return 'Entry only';
		case 'output':
			return 'Output';
		default:
			return role;
	}
}

/** A member of a group as the apply preview lists it. */
export interface PreviewSlot {
	parameterId: string;
	code: string;
	name: string;
	role: string;
}

/** What an apply would do at this site, read from the route's dry run. */
export interface GroupApplyPreview {
	adding: PreviewSlot[];
	held: PreviewSlot[];
	/** Nothing to apply: the site already holds every member of the group. */
	applicable: boolean;
}

interface GroupSlotResponse {
	parameter_id: string;
	parameter_code: string;
	role: string;
}

/**
 * The two lists the panel shows before Apply is pressed. The catalog names the parameters; one the
 * page does not carry reads as its code, which is what the route returned.
 */
export function groupApplyPreview(
	response: { created: GroupSlotResponse[]; existing: GroupSlotResponse[] },
	nameOf: (parameterId: string) => string | null,
): GroupApplyPreview {
	const line = (slot: GroupSlotResponse): PreviewSlot => ({
		parameterId: slot.parameter_id,
		code: slot.parameter_code,
		name: nameOf(slot.parameter_id) ?? slot.parameter_code,
		role: roleLabel(slot.role),
	});
	const adding = response.created.map(line);
	return { adding, held: response.existing.map(line), applicable: adding.length > 0 };
}

function namesClause(slots: PreviewSlot[], singular: string, plural: string): string {
	const names = slots.map((s) => s.name);
	const joined = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
	return `${joined} ${names.length > 1 ? plural : singular}`;
}

/**
 * The toast after Apply. The preview was the promise, so the write is only described where it
 * differs from it: another operator changed the site's slots or the group between the two.
 */
export function groupAppliedMessage(promised: GroupApplyPreview | null, landed: GroupApplyPreview): string {
	if (!promised) return 'Group applied';
	const ids = (slots: PreviewSlot[]) => new Set(slots.map((s) => s.parameterId));
	const willAdd = ids(promised.adding);
	const wasHeld = ids(promised.held);
	const added = ids(landed.adding);
	const held = ids(landed.held);
	const clauses = [
		[landed.held.filter((s) => willAdd.has(s.parameterId)), 'was added by someone else', 'were added by someone else'],
		[
			landed.adding.filter((s) => wasHeld.has(s.parameterId)),
			'was removed by someone else and added back',
			'were removed by someone else and added back',
		],
		[
			[...landed.adding, ...landed.held].filter((s) => !willAdd.has(s.parameterId) && !wasHeld.has(s.parameterId)),
			'joined the group since the preview',
			'joined the group since the preview',
		],
		[
			[...promised.adding, ...promised.held].filter((s) => !added.has(s.parameterId) && !held.has(s.parameterId)),
			'left the group since the preview',
			'left the group since the preview',
		],
	] as const;
	const drift = clauses
		.filter(([slots]) => slots.length > 0)
		.map(([slots, singular, plural]) => namesClause([...slots], singular, plural));
	if (drift.length === 0) return 'Group applied';
	const count =
		landed.adding.length === promised.adding.length
			? `${landed.adding.length} added, as many as previewed`
			: `${landed.adding.length} added, not the ${promised.adding.length} previewed`;
	return `${count}: ${drift.join('; ')}`;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * The server's refusal, with any group id it names replaced by that group's label. The refusals are
 * typed server-side, so the message is surfaced rather than rewritten; only the id a scientist
 * cannot read is resolved.
 */
export function assignmentError(e: unknown, groups: NamedGroup[]): string {
	const message = apiMessage(e);
	return message.replace(UUID, (id) => {
		const group = groups.find((g) => g.id.toLowerCase() === id.toLowerCase());
		return group ? `${group.label} (${group.code})` : id;
	});
}

/**
 * What the member column holds for a parameter entered several times at one visit. The spec is the
 * declaration itself and carries nothing: how many repeats a visit records is the entry grid's,
 * seeded from what the site last did at that parameter (Q61).
 */
export type ReplicateSpec = Record<string, unknown>;

/**
 * The declaration a member row writes: an empty spec where the parameter is entered several times
 * at one visit, null where it is entered once. Replicate-ness is the parameter's, and it is what a
 * calculation manifest reads to declare a source the whole family rather than its mean (Q155).
 */
export function replicateSpec(replicated: boolean): ReplicateSpec | null {
	return replicated ? {} : null;
}

/** Whether a stored spec declares the member replicated. Any spec does, including an empty one. */
export function replicated(replicates: Record<string, unknown> | null): boolean {
	return replicates !== null && replicates !== undefined;
}

/** The body a parameter is assigned to a group with, carrying its replicate declaration. */
export function assignBody(
	groupId: string,
	parameterId: string,
	ordinal: number,
	replicated: boolean,
) {
	return {
		group_id: groupId,
		parameter_id: parameterId,
		ordinal,
		replicates: replicateSpec(replicated),
	};
}
