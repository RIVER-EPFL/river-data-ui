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
 * The confirmation an edit needs before it is written: which scripts run again and which output
 * parameters move. Null when nothing reads the value, which is when no confirmation is warranted.
 */
export function editConsequence(
	calculations: { tool: string; label: string; outputs: { parameter_code: string }[] }[]
): string | null {
	if (calculations.length === 0) return null;
	const lines = calculations.map((c) => {
		const outputs = c.outputs.map((o) => o.parameter_code).join(', ');
		return outputs ? `${c.label} rewrites ${outputs}` : `${c.label} runs again`;
	});
	return `Saving this recomputes ${calculations.length} calculation${
		calculations.length === 1 ? '' : 's'
	} at this visit: ${lines.join('; ')}.`;
}
