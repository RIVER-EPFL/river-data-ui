import type { HoldKind, LedgerEntry, ReadingDecision } from '$api/service';
import { formatCount } from '$lib/format';
import { triggerLabel } from '$lib/utils';
import { changedFields, decisionLabel, timelineEntries, type DecisionEntry, type FieldChange } from './decisions';

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

function decisionLine(entry: LedgerEntry): string {
	return decisionLabel(leadingToken(entry.what));
}

function holdLine(entry: LedgerEntry): string {
	const match = /^(\S+) \((.+)\)$/.exec(entry.what);
	const kind = match?.[1] ?? entry.what;
	const status = match?.[2] ?? '';
	const label = labelled(HOLD_LABELS as Record<string, string>, kind, entry.what);
	const state = status ? labelled(HOLD_STATUSES, status, status) : '';
	return state ? `${label}, ${state}` : label;
}

function changeLine(entry: LedgerEntry): string {
	return labelled(CHANGE_LABELS as Record<string, string>, entry.what, entry.what);
}

/// A job says what it was for and how it ended.
function jobLine(entry: LedgerEntry): string {
	const [trigger, ...rest] = entry.what.split(' ');
	const tail = rest.join(' ');
	const failure = tail.startsWith('failed:') ? tail.slice('failed:'.length).trim() : null;
	const status = failure === null ? labelled(JOB_STATUSES, tail, tail) : 'failed';
	return `${triggerLabel(trigger)} ${status}${failure ? `: ${failure}` : ''}`;
}

function ingestLine(entry: LedgerEntry): string {
	const counts = (entry.new ?? {}) as Record<string, number | boolean>;
	if (counts.braked) return 'Reload from the source stopped by the brake';
	const changed = Number(counts.changed ?? 0);
	const added = Number(counts.new ?? 0);
	return `Reloaded from the source: ${formatCount(added)} new, ${formatCount(changed)} changed`;
}

function toolRunLine(entry: LedgerEntry): string {
	const match = /^(.+) \((.+)\)$/.exec(entry.what);
	const tool = match?.[1] ?? entry.what;
	const source = match?.[2] ?? '';
	const how = source ? labelled(RUN_SOURCES, source, source) : '';
	return `Calculated by ${tool}${how ? `, run ${how}` : ''}`;
}

function alarmLine(entry: LedgerEntry): string {
	return entry.what.endsWith('resolved') ? 'Alarm raised, since resolved' : 'Alarm raised';
}

/// Every arm `GET /readings/ledger` unions, in plain words. An arm this build does not know
/// prints what the API said rather than nothing.
export function ledgerLine(entry: LedgerEntry): string {
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
			return entry.what;
		case 'ingest':
			return ingestLine(entry);
		case 'tool_run':
			return toolRunLine(entry);
		case 'alarm':
			return alarmLine(entry);
		default:
			return entry.what;
	}
}

/// Who made a change, in the words the history table prints beside the actor.
const DECISION_ORIGINS: Record<string, string> = {
	manual: 'person',
	sync: 'sync',
	csv: 'import',
	audit: 'review',
	chain: 'chain',
	rollback: 'rollback',
	system: 'system',
	janitor: 'sweep',
};

const SOURCE_ORIGINS: Record<string, string> = {
	ingest: 'sync',
	tool_run: 'tool',
	job: 'job',
	job_log: 'job',
	hold: 'review',
	alarm: 'sweep',
	change: 'person',
};

/// One row of a record's history table: one dated event, a set of decisions being one act.
export interface HistoryRow {
	key: string;
	at: string;
	what: string;
	changes: FieldChange[];
	reason: string | null;
	who: string | null;
	origin: string;
	severity: string;
	/// The decision the row undoes, where it is one.
	decision: DecisionEntry | null;
	entry: LedgerEntry;
}

/// The ledger as the history table's rows, newest first. The decisions ride on their entries, so
/// a set's decisions at this reading read as one row under the set's first decision.
export function historyRows(entries: LedgerEntry[]): HistoryRow[] {
	const decisions = entries
		.map((e) => e.decision)
		.filter((d): d is ReadingDecision => !!d);
	const acts = timelineEntries(decisions);
	const heads = new Map(acts.map((a) => [a.head.id, a]));
	const members = new Set(acts.flatMap((a) => a.members.slice(1).map((m) => m.id)));
	return entries
		.filter((e) => e.source !== 'decision' || !members.has(e.id))
		.map((entry): HistoryRow => {
			const act = entry.source === 'decision' ? (heads.get(entry.id) ?? null) : null;
			const d = act?.head ?? null;
			return {
				key: `${entry.source}:${entry.id}:${entry.at}`,
				at: entry.at,
				what: d ? decisionLabel(d.kind) : ledgerLine(entry),
				changes: d ? changedFields(d) : [],
				reason: d?.reason?.trim() ? d.reason : null,
				who: entry.actor ?? null,
				origin: d ? (DECISION_ORIGINS[d.origin] ?? d.origin) : (SOURCE_ORIGINS[entry.source] ?? entry.source),
				severity: entry.severity,
				decision: act,
				entry,
			};
		})
		.sort((a, b) => b.at.localeCompare(a.at));
}
