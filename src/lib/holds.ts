// Kinds beyond the replicate-statistics disagreement: reconciliation holds (stream-keyed),
// event-audit findings (slot-keyed, stream_id null), the hand-entry hold and the field day's own.
//
// What the review queue says about each kind of hold it carries: the chip on the row, the colour
// that chip takes, and the sentence explaining what happened. One entry per kind of
// `HoldKind`, so a kind the API starts raising reaches the queue with a label rather than blank.

import { type HoldKind } from '$api/service';
import { holdKindLabel } from '$lib/utils';

export const KIND_LABEL: Record<HoldKind, string> = {
	replicate_stats: holdKindLabel('replicate_stats'),
	source_modified: holdKindLabel('source_modified'),
	brake_fired: holdKindLabel('brake_fired'),
	missing_output: holdKindLabel('missing_output'),
	stale_output: holdKindLabel('stale_output'),
	skipped_output: holdKindLabel('skipped_output'),
	curve_claim_stripped: holdKindLabel('curve_claim_stripped'),
	unverified_entry: holdKindLabel('unverified_entry'),
	unverified_visit: holdKindLabel('unverified_visit'),
	source_identity_changed: holdKindLabel('source_identity_changed'),
};

export const KIND_STYLE: Record<HoldKind, string> = {
	replicate_stats: 'bg-brand-bg text-brand-text',
	source_modified: 'bg-severity-warning-soft text-severity-warning-text',
	brake_fired: 'bg-severity-alarm-soft text-severity-alarm',
	missing_output: 'bg-severity-warning-soft text-severity-warning-text',
	stale_output: 'bg-severity-warning-soft text-severity-warning-text',
	skipped_output: 'bg-severity-warning-soft text-severity-warning-text',
	curve_claim_stripped: 'bg-severity-warning-soft text-severity-warning-text',
	unverified_entry: 'bg-brand-bg text-brand-text',
	unverified_visit: 'bg-severity-warning-soft text-severity-warning-text',
	source_identity_changed: 'bg-severity-warning-soft text-severity-warning-text',
};

export const KIND_TIP: Record<HoldKind, string> = {
	replicate_stats: "The group's recomputed statistics disagree with the source's stored avg/sd.",
	source_modified:
		'The source changed or withdrew a reading that carries curation (a flag, a hand-picked curve, or a labelled sample). The value change applied; the curation and servedness did not move without this review.',
	brake_fired:
		'A reconciliation pass wanted to change or withdraw more of this stream than the brake allows. Its new rows applied; the reshape did not. Acknowledging admits exactly one braked-scale pass on the next sync cycle.',
	missing_output: "The tool's declared inputs exist at this visit but its output was never saved.",
	stale_output:
		'The stored output disagrees with a recompute under the same pinned script version, typically after an upstream correction.',
	skipped_output:
		'A calculation did not run at this visit and its output is absent. The reason it stopped, an input that did not resolve or a script that raised, is recorded on the finding. The repair is a recompute once the cause is fixed.',
	curve_claim_stripped:
		"The source named a standard curve this reading cannot carry (fitted on a different instrument, or not a spot measurement). The values were stored uncorrected; the claim is recorded here. Fix the curve's instrument or the stream's, then re-sync to apply the correction.",
	unverified_entry:
		'A value entered by hand that nobody has ruled on yet. It is stored and shown as pending, and it is not served until someone verifies it. Verify accepts the value as it stands; Reject withdraws it with a reason.',
	unverified_visit:
		'An intern opened this field day and nobody has ruled on whether it should exist. Verifying it says the visit happened, and no more: each measurement in it is still verified on its own. Rejecting it withdraws the visit with every reading entered there; nothing is deleted.',
	source_identity_changed:
		'The device behind this feed reports an identity that is not the one stored for it. The readings kept arriving and are stored as they were; what measured them is what this hold asks about. Adopt or swap the instrument if the device really changed, then acknowledge.',
};

/** What a source-identity hold says changed, as the fields the source reported differently. */
export interface IdentityChange {
	field: string;
	was: string;
	now: string;
}

function textOf(value: unknown): string {
	if (value === null || value === undefined || value === '') return 'not reported';
	return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/**
 * The stored and reported identity of a feed's device, field by field. The hold names the fields
 * that moved; where it does not, every field either side carries is compared.
 */
export function identityChanges(expected: unknown, computed: unknown): IdentityChange[] {
	const was = (expected as { was?: Record<string, unknown> } | null)?.was ?? {};
	const now = (computed as { now?: Record<string, unknown> } | null)?.now ?? {};
	const named = (expected as { fields?: unknown } | null)?.fields;
	const fields = Array.isArray(named)
		? named.map(String)
		: [...new Set([...Object.keys(was), ...Object.keys(now)])];
	return fields.map((field) => ({
		field,
		was: textOf(was[field]),
		now: textOf(now[field]),
	}));
}
