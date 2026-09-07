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
