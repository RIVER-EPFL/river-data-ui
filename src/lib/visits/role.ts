// What a value is for, as the grid draws it.
//
// A cell an active calculation reads is not the same thing as one a calculation writes, and
// neither is the same as a plain measurement nothing derives. Colour carries the role and the
// tooltip names the script, so a person typing a number can see what it feeds before saving it,
// rather than discovering it in a recompute afterwards.

import type { EventCell } from '$api/service';

export type CellRole = 'input' | 'output' | 'plain';

export interface CellRoleInfo {
	role: CellRole;
	/** The class the cell carries. Plain cells take none, so the marked ones stand out. */
	className: string;
	/** What the role means, named with the calculations involved. */
	title: string | null;
}

/**
 * A cell a calculation writes is an output first: its value came from a script, and that is the
 * more consequential thing to say about it even when another calculation reads it in turn.
 */
export function cellRole(cell: Pick<EventCell, 'read_by' | 'written_by'>): CellRoleInfo {
	const reads = cell.read_by ?? [];
	if (cell.written_by) {
		const also = reads.length > 0 ? `, read by ${reads.join(', ')}` : '';
		return {
			role: 'output',
			className: 'border-l-2 border-brand-accent',
			title: `Computed by ${cell.written_by}${also}`,
		};
	}
	if (reads.length > 0) {
		return {
			role: 'input',
			className: 'border-l-2 border-brand-primary',
			title: `Read by ${reads.join(', ')}: editing this recomputes what they write`,
		};
	}
	return { role: 'plain', className: '', title: null };
}

/**
 * The role every cell of a grid column carries, from what the listing says reads and writes its
 * parameter. It holds whichever visit the cell is at and whether a value is stored there yet.
 */
export function columnRole(column: { readBy: string[]; writtenBy: string | null }): CellRoleInfo {
	return cellRole({ read_by: column.readBy, written_by: column.writtenBy ?? undefined });
}

/** Every class a role puts on a cell, so a reused cell can be cleared of the last one's. */
export const ROLE_CLASSES = ['border-l-2', 'border-brand-accent', 'border-brand-primary'];

/**
 * The confirmation an edit needs before it is written: which scripts run again, which output
 * parameters move, and what each of those holds today (M52). Null when nothing reads the value,
 * which is when no confirmation is warranted.
 *
 * `stored` is what the visit serves for each output code. An output the visit has no value for
 * says so rather than reading as a blank.
 */
export function editConsequence(
	calculations: { tool: string; label: string; outputs: { parameter_code: string }[] }[],
	stored: Record<string, number | null | undefined> = {}
): string | null {
	if (calculations.length === 0) return null;
	const named = (code: string) => {
		const value = stored[code];
		return value === null || value === undefined ? `${code} (no value yet)` : `${code} (now ${value})`;
	};
	const lines = calculations.map((c) => {
		const outputs = c.outputs.map((o) => named(o.parameter_code)).join(', ');
		return outputs ? `${c.label} rewrites ${outputs}` : `${c.label} runs again`;
	});
	return `Saving this recomputes ${calculations.length} calculation${
		calculations.length === 1 ? '' : 's'
	} at this visit: ${lines.join('; ')}.`;
}

/**
 * Whether the person signed in may type into one cell, and why not when they may not.
 *
 * An intern enters measurements and does not change stored ones (Q21): the API admits their save
 * through `enter_field_data` and refuses a replace in the handler, so the grid marks the cells they
 * cannot save rather than letting them type into all of them and returning a 403 afterwards. The
 * server stays the authority; this is the affordance.
 */
export function cellWritable(
	level: number,
	stored: number | null
): { writable: boolean; reason: string | null } {
	if (level >= RIVER_LEVEL) return { writable: true, reason: null };
	if (level < INTERN_LEVEL) {
		return { writable: false, reason: 'Your account holds no level that may enter data.' };
	}
	if (stored === null) return { writable: true, reason: null };
	return {
		writable: false,
		reason: 'An intern enters measurements; a stored value is a manager\'s to change.',
	};
}

/** The access levels this rule turns on, matching the API's `Role::level()`. */
const INTERN_LEVEL = 1;
const RIVER_LEVEL = 2;
