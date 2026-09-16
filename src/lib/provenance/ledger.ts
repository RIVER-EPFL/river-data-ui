import type { HoldKind, LedgerEntry } from '$api/service';
import { formatCount } from '$lib/format';
import { triggerLabel } from '$lib/utils';
import { decisionLabel } from './decisions';

/// Whether an entry moved the number a reader came for, or says something about how it is
/// administered. A value entry is drawn in full; an administrative one is faded and folded away.
export type LedgerWeight = 'value' | 'administrative';

export interface LedgerLine {
	text: string;
	weight: LedgerWeight;
}

/// The edits `change_audit` records against a catalogue parameter or a site's slot: the two
/// subjects the reading ledger reads, under the trigger's `{subject}_{op}` and the merge's own.
export const CHANGE_KINDS = [
	'parameter_insert',
	'parameter_update',
	'parameter_delete',
	'parameter_merge',
	'site_parameter_insert',
	'site_parameter_update',
	'site_parameter_delete',
	'site_parameter_merge',
] as const;

export type ChangeKind = (typeof CHANGE_KINDS)[number];

const CHANGE_LABELS: Record<ChangeKind, string> = {
	parameter_insert: 'Parameter added to the catalogue',
	parameter_update: 'Parameter edited in the catalogue',
	parameter_delete: 'Parameter removed from the catalogue',
	parameter_merge: 'Parameter merged into another',
	site_parameter_insert: 'Parameter added at this site',
	site_parameter_update: 'How this site serves the parameter changed',
	site_parameter_delete: 'Parameter removed from this site',
	site_parameter_merge: 'Slot merged into another',
};

const HOLD_LABELS: Record<HoldKind, string> = {
	replicate_stats: 'Statistics disagreement raised',
	source_modified: 'The source changed a curated value',
	brake_fired: 'Reconciliation brake fired',
	missing_output: 'A calculation produced no output',
	stale_output: 'A calculation output went stale',
	skipped_output: 'A calculation did not run',
	curve_claim_stripped: 'A curve claim was stripped',
	unverified_entry: 'Entered and awaiting verification',
	unverified_visit: 'The visit is awaiting verification',
	source_identity_changed: 'The feed reports a different instrument',
};

/// The statuses a hold is read under, `pending` through `superseded`. The three legacy ones are
/// only ever seen in history.
const HOLD_STATUSES: Record<string, string> = {
	pending: 'waiting for a ruling',
	deferred: 'deferred until the stream is paired',
	acknowledged: 'ruled on',
	remediated: 'remediated',
	superseded: 'superseded',
	use_portal: 'closed, the portal value kept',
	use_manual: 'closed, the entered value kept',
	consumed: 'closed',
};

const JOB_STATUSES: Record<string, string> = {
	queued: 'queued',
	pending: 'queued',
	running: 'running',
	retrying: 'retrying',
	completed: 'completed',
	failed: 'failed',
	cancelled: 'cancelled',
};

/// How a tool run was minted, as `tool_runs.source` records it.
const RUN_SOURCES: Record<string, string> = {
	interactive: 'by hand',
	csv_import: 'from a CSV import',
	chain: 'by a chain run',
};

function labelled(
	table: Record<string, string>,
	key: string,
	fallback: string,
): string {
	return table[key] ?? fallback;
}

/// The kind a composed `what` was built from. Each arm writes its kind as the leading token, so
/// the reader takes it back rather than matching on the whole sentence.
export function leadingToken(what: string): string {
	return what.split(/[\s:(]/, 1)[0] ?? what;
}

function decisionLine(entry: LedgerEntry): LedgerLine {
	return { text: decisionLabel(leadingToken(entry.what)), weight: 'value' };
}

function holdLine(entry: LedgerEntry): LedgerLine {
	const match = /^(\S+) \((.+)\)$/.exec(entry.what);
	const kind = match?.[1] ?? entry.what;
	const status = match?.[2] ?? '';
	const label = labelled(HOLD_LABELS as Record<string, string>, kind, entry.what);
	const state = status ? labelled(HOLD_STATUSES, status, status) : '';
	return { text: state ? `${label}, ${state}` : label, weight: 'administrative' };
}

function changeLine(entry: LedgerEntry): LedgerLine {
	return {
		text: labelled(CHANGE_LABELS as Record<string, string>, entry.what, entry.what),
		weight: 'administrative',
	};
}

/// A job says what it was for and how it ended. It counts as a value entry only where it moved
/// rows: a sweep that found nothing to do is plumbing.
function jobLine(entry: LedgerEntry): LedgerLine {
	const [trigger, ...rest] = entry.what.split(' ');
	const tail = rest.join(' ');
	const failure = tail.startsWith('failed:') ? tail.slice('failed:'.length).trim() : null;
	const status = failure === null ? labelled(JOB_STATUSES, tail, tail) : 'failed';
	const moved = Number((entry.new as { readings_updated?: number } | null)?.readings_updated ?? 0);
	const text = `${triggerLabel(trigger)} ${status}${failure ? `: ${failure}` : ''}`;
	return { text, weight: moved > 0 ? 'value' : 'administrative' };
}

function ingestLine(entry: LedgerEntry): LedgerLine {
	const counts = (entry.new ?? {}) as Record<string, number | boolean>;
	if (counts.braked) {
		return { text: 'Reload from the source stopped by the brake', weight: 'administrative' };
	}
	const changed = Number(counts.changed ?? 0);
	const added = Number(counts.new ?? 0);
	return {
		text: `Reloaded from the source: ${formatCount(added)} new, ${formatCount(changed)} changed`,
		weight: 'administrative',
	};
}

function toolRunLine(entry: LedgerEntry): LedgerLine {
	const match = /^(.+) \((.+)\)$/.exec(entry.what);
	const tool = match?.[1] ?? entry.what;
	const source = match?.[2] ?? '';
	const how = source ? labelled(RUN_SOURCES, source, source) : '';
	return { text: `Calculated by ${tool}${how ? `, run ${how}` : ''}`, weight: 'value' };
}

function alarmLine(entry: LedgerEntry): LedgerLine {
	return {
		text: entry.what.endsWith('resolved') ? 'Alarm raised, since resolved' : 'Alarm raised',
		weight: 'administrative',
	};
}

/// Every arm `GET /readings/ledger` unions, in plain words. An arm this build does not know
/// prints what the API said rather than nothing.
export function ledgerLine(entry: LedgerEntry): LedgerLine {
	switch (entry.source) {
		case 'decision':
			return decisionLine(entry);
		case 'hold':
			return holdLine(entry);
		case 'change':
			return changeLine(entry);
		case 'job':
			return jobLine(entry);
		case 'job_log':
			return { text: entry.what, weight: 'administrative' };
		case 'ingest':
			return ingestLine(entry);
		case 'tool_run':
			return toolRunLine(entry);
		case 'alarm':
			return alarmLine(entry);
		default:
			return { text: entry.what, weight: 'administrative' };
	}
}

/// A failure or a warning is never faded: it is what a reader opened the history to find.
export function ledgerWeight(entry: LedgerEntry): LedgerWeight {
	if (entry.severity !== 'info') return 'value';
	return ledgerLine(entry).weight;
}
