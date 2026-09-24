import type { LedgerEntry, ReadingDecision } from '$api/service';

/// Every kind `reading_decisions` records, mirroring `Kind::as_str` in
/// `river-data-api/src/routes/private/readings/models.rs`. Declared so a kind with no label fails
/// the check rather than printing its code in the timeline.
export const DECISION_KINDS = [
	'flag',
	'unflag',
	'withdraw',
	'reassert',
	'curve',
	'calibration_pin',
	'instrument_pin',
	'slot_move',
	'value_correction',
	'unverified_entry',
	'verify',
	'reject',
	'chain',
	'detach',
	'return',
	'curve_retire',
	'formula_transition',
	'curve_recompose',
	'derived_computed',
	'reprocess',
	'retag',
	'attribution',
	'rollback',
] as const;

export type DecisionKind = (typeof DECISION_KINDS)[number];

/// Each kind as a person reads it. The edit options an operator chooses are a different
/// vocabulary (`EDIT_METHODS`): a decision the chain or a merge wrote was never offered as an
/// option, and still has to be readable in the timeline.
const LABELS: Record<DecisionKind, string> = {
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
	curve_retire: 'Standard curve retired, the value moved off it',
	formula_transition: 'Recomputed under a new formula version',
	curve_recompose: 'Recomposed from the curves it names',
	derived_computed: 'Computed where nothing was stored',
	reprocess: 'Re-derived by a reprocess',
	retag: 'Reclassified by a retag',
	attribution: 'Attributed by a pairing, an adoption or a rollback',
	rollback: 'Rolled back',
};

export function decisionLabel(kind: string): string {
	return LABELS[kind as DecisionKind] ?? kind;
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
	derived_version_id: 'Formula version',
	measurement_type: 'Measurement type',
	deployment_id: 'Deployment',
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
	if (rulingHold(d)) return false;
	if (d.reversible !== undefined) return d.reversible;
	return d.kind !== 'rollback';
}

/// The verification hold a standing ruling recorded this decision under. The ruling is undone by
/// reopening that hold, which returns it to the review queue, never by rolling the decision back.
export function rulingHold(d: ReadingDecision): string | null {
	if (d.rolled_back_by) return null;
	return d.ruling_hold_id ?? null;
}

/// One decision a rollback would invert, named by the parameter its reading measures.
export interface RestoredMember {
	decision: ReadingDecision;
	parameter_code: string | null;
}

function shown(v: unknown): string {
	if (v === null || v === undefined || v === '') return 'nothing';
	return typeof v === 'string' ? v : JSON.stringify(v);
}

/// What a rollback puts back, one line per decision still live: each field it moved, from the
/// value it holds now to the value it held before. A decision already rolled back is left out.
export function restoredLines(members: RestoredMember[]): string[] {
	return members
		.filter((m) => !m.decision.rolled_back_by)
		.map(({ decision: d, parameter_code }) => {
			const replicate =
				d.replicate_index === null || d.replicate_index === undefined
					? ''
					: ` replicate ${d.replicate_index}`;
			const changes = changedFields(d)
				.map((c) => `${fieldLabel(c.field)} ${shown(c.to)} → ${shown(c.from)}`)
				.join(', ');
			return `${parameter_code ?? 'unpaired reading'}${replicate}: ${changes || `${decisionLabel(d.kind)}, undone`}`;
		});
}
