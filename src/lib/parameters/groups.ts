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
