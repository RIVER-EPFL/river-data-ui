// Kinds beyond the replicate-statistics disagreement: reconciliation holds (stream-keyed),
// event-audit findings (slot-keyed, stream_id null), the hand-entry hold and the field day's own.
//
// What the review queue says about each kind of hold it carries: the chip on the row, the colour
// that chip takes, and the sentence explaining what happened. One entry per kind of
// `HoldKind`, so a kind the API starts raising reaches the queue with a label rather than blank.

import { type HoldKind } from '$api/service';
import { readingTagsHref } from '$lib/discrepancies';
import { holdKindLabel } from '$lib/utils';

/** A manager's ruling on what an intern entered, worked on the Visits page. */
export const VERIFICATION_KINDS: HoldKind[] = ['unverified_visit', 'unverified_entry'];

/** What the chain and the event audit raise, worked under their calculation on the Toolbox. */
export const CALCULATION_FINDING_KINDS: HoldKind[] = ['missing_output', 'stale_output', 'skipped_output'];

/** What a sync pass holds on one stream, released from that stream's own dialog. */
export const STREAM_KINDS: HoldKind[] = ['brake_fired'];

/** A feed reporting a different device, worked on the instrument's page. */
export const INSTRUMENT_KINDS: HoldKind[] = ['source_identity_changed'];

/** Tags an import recorded on the data, read on the discrepancy browse and never worked. */
export const TAG_KINDS: HoldKind[] = ['replicate_stats', 'curve_claim_stripped'];

/** The kinds the audits queue lists: every kind not worked or browsed on a page of its own. */
export const AUDIT_QUEUE_KINDS: HoldKind[] = ['source_modified'];

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
		'A value entered in the grid that nobody has ruled on yet. It is stored and shown as pending, and it is not served until someone verifies it. Verify accepts the value as it stands; Reject withdraws it with a reason.',
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

/** What a fired brake held back, as one sentence, from the counts the pass recorded. */
export function brakeSummary(expected: unknown): string | null {
	const e = expected as { would_change?: number; would_withdraw?: number; stored_in_window?: number } | null;
	if (e?.would_change == null || e.would_withdraw == null || e.stored_in_window == null) return null;
	return `The pass would change ${e.would_change} and withdraw ${e.would_withdraw} of ${e.stored_in_window} stored readings.`;
}

/** A hold as a reading's record names it. */
export interface HoldLink {
	id: string;
	kind: string;
	status: string;
	tool?: string | null;
}

/** The reading a hold chip sits on, and what its record names around it. */
export interface HoldLinkContext {
	siteId: string;
	parameterId: string;
	timeIso: string;
	eventId?: string;
	streamId?: string;
	sensorId?: string;
}

/** Where a hold is listed: each kind opens the page it is worked or browsed on. */
export function holdHref(base: string, hold: HoldLink, at: HoldLinkContext): string {
	const kind = hold.kind as HoldKind;
	if (TAG_KINDS.includes(kind)) return readingTagsHref(at.siteId, at.parameterId, at.timeIso, kind);
	if (VERIFICATION_KINDS.includes(kind)) {
		return at.eventId
			? `${base}/sites/${at.siteId}?tab=visits&event=${at.eventId}`
			: `${base}/events?pending=1`;
	}
	if (CALCULATION_FINDING_KINDS.includes(kind)) {
		return hold.tool ? `${base}/toolbox?findings=${encodeURIComponent(hold.tool)}` : `${base}/toolbox`;
	}
	if (STREAM_KINDS.includes(kind)) {
		return at.streamId ? `${base}/streams?stats=${at.streamId}` : `${base}/streams`;
	}
	if (INSTRUMENT_KINDS.includes(kind)) {
		return at.sensorId ? `${base}/sensors/${at.sensorId}` : `${base}/sensors`;
	}
	const params = new URLSearchParams({ tab: 'review', review: 'actionable', holds_id: hold.id });
	if (hold.status !== 'pending') params.set('view', 'resolved');
	return `${base}/streams?${params}`;
}
