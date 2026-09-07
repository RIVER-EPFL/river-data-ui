import type { ReadingDecision } from '$api/service';

/// Every kind `reading_decisions` records, as a person reads it. The edit options an operator
/// chooses are a different vocabulary (`EDIT_METHODS`): a decision the chain or a merge wrote was
/// never offered as an option, and still has to be readable in the timeline.
const LABELS: Record<string, string> = {
	flag: 'Flagged',
	unflag: 'Unflagged',
	withdraw: 'Withdrawn',
	reassert: 'Reasserted',
	reject: 'Entry rejected',
	curve: 'Standard curve changed',
	calibration_pin: 'Calibration pinned',
	instrument_pin: 'Instrument pinned',
	slot_move: 'Moved to another parameter',
	value_correction: 'Value corrected',
	unverified_entry: 'Entered as pending',
	verify: 'Entry verified',
	chain: 'Calculated by a chain run',
	detach: 'Detached from its calculation',
	return: 'Returned to its calculation',
	rollback: 'Rolled back',
};

export function decisionLabel(kind: string): string {
	return LABELS[kind] ?? kind;
}

export interface FieldChange {
	field: string;
	from: unknown;
	to: unknown;
}

const FIELD_LABELS: Record<string, string> = {
	raw_value: 'Measured',
	calibrated_value: 'Corrected',
	is_flagged: 'Flagged',
	flag_reason: 'Flag reason',
	withdrawn_at: 'Withdrawn',
	withdrawn_reason: 'Withdrawal reason',
	standard_curve_id: 'Standard curve',
	calibration_id: 'Calibration',
	sensor_id: 'Instrument',
	unverified: 'Pending',
	site_id: 'Site',
	parameter_id: 'Parameter',
	run_id: 'Tool run',
};

export function fieldLabel(field: string): string {
	return FIELD_LABELS[field] ?? field;
}

/// What a decision moved, as before and after. A rollback asserts the columns it restores under
/// `columns`; every other kind asserts them directly. `old` is the state the record captured, so a
/// field the assertion names and the record did not is shown as arriving from nothing.
export function changedFields(d: ReadingDecision): FieldChange[] {
	const asserted =
		d.kind === 'rollback'
			? ((d.new?.columns as Record<string, unknown> | undefined) ?? {})
			: (d.new ?? {});
	const old = (d.old ?? {}) as Record<string, unknown>;
	return Object.keys(asserted)
		.filter((f) => f !== 'reason' && f !== 'of')
		.map((field) => ({ field, from: old[field] ?? null, to: asserted[field] }))
		.filter((c) => JSON.stringify(c.from) !== JSON.stringify(c.to));
}

export interface DecisionEntry {
	/// The decision shown, which for a set is the first of them.
	head: ReadingDecision;
	/// Every decision the entry stands for, one for a single decision and all of them for a set.
	members: ReadingDecision[];
	set_id: string | null;
}

/// The timeline as entries: a set-level decision is one act, not one line per row it projected.
/// Order is the order given, which the API returns newest first.
export function timelineEntries(decisions: ReadingDecision[]): DecisionEntry[] {
	const entries: DecisionEntry[] = [];
	const bySet = new Map<string, DecisionEntry>();
	for (const d of decisions) {
		const set = d.set_id ?? null;
		if (!set) {
			entries.push({ head: d, members: [d], set_id: null });
			continue;
		}
		const existing = bySet.get(set);
		if (existing) {
			existing.members.push(d);
			continue;
		}
		const entry: DecisionEntry = { head: d, members: [d], set_id: set };
		bySet.set(set, entry);
		entries.push(entry);
	}
	return entries;
}

/// Whether the timeline offers to undo an entry. The API says which kinds `rollback` accepts
/// (`reversible` on the row), so the reader never keeps its own copy of that list; an older API
/// that does not send the field leaves the decision to the kind alone.
export function undoable(d: ReadingDecision): boolean {
	if (d.rolled_back_by) return false;
	if (d.reversible !== undefined) return d.reversible;
	return d.kind !== 'rollback';
}
