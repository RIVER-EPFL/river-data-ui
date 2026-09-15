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

/** What the member column holds for a parameter entered several times at one visit. */
export interface ReplicateSpec extends Record<string, unknown> {
	suggested: number;
}

/**
 * The declaration a member row writes: a count the entry form opens with, or null where the
 * parameter is entered once. Replicate-ness is the parameter's, and it is what a calculation
 * manifest reads to declare a source the whole family rather than its mean (Q155).
 */
export function replicateSpec(count: number | null): ReplicateSpec | null {
	if (count === null || !Number.isFinite(count) || count < 1) return null;
	return { suggested: Math.floor(count) };
}

/** The count a stored spec suggests. A spec carrying none still declares the member replicated. */
export function suggestedCount(replicates: Record<string, unknown> | null): number | null {
	const suggested = replicates?.suggested;
	return typeof suggested === 'number' && Number.isFinite(suggested) ? suggested : null;
}

/** The body a parameter is assigned to a group with, carrying its replicate declaration. */
export function assignBody(
	groupId: string,
	parameterId: string,
	ordinal: number,
	count: number | null,
) {
	return {
		group_id: groupId,
		parameter_id: parameterId,
		ordinal,
		replicates: replicateSpec(count),
	};
}
