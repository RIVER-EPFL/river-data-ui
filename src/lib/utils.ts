import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { timezoneStore } from '$lib/stores/timezone.svelte';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export function formatRelativeTime(date: string | Date): string {
	const now = Date.now();
	const then = new Date(date).getTime();
	const diff = now - then;

	if (diff < 60_000) return 'just now';
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
	if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)} d ago`;
	return formatDate(date);
}

// Times render in the browser's local zone by default; the global preference (header
// toggle / Settings) flips every consumer to UTC. `timeZoneName: 'short'` always labels
// the zone so a displayed time is never ambiguous. Reading `timezoneStore.zone` here makes
// these formatters reactive at their ~40 call sites with no change at those sites.
export function formatDateTime(date: string | Date): string {
	return new Date(date).toLocaleString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		timeZone: timezoneStore.zone,
		timeZoneName: 'short',
	});
}

/** Just the time of day, in the zone the preference names: for a mark that is read the same minute. */
export function formatClockTime(date: string | Date): string {
	return new Date(date).toLocaleTimeString(undefined, {
		hour: '2-digit',
		minute: '2-digit',
		timeZone: timezoneStore.zone,
	});
}

/**
 * A chart tooltip's instant, from epoch milliseconds: the same fields and the same browser locale
 * as `formatDateTime`, so a time in a tooltip reads as the time in the table beside it. `utc`
 * labels the underlying UTC instant whatever the preference says.
 */
export function formatInstant(ms: number, opts: { utc?: boolean } = {}): string {
	return new Date(ms).toLocaleString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		timeZone: opts.utc ? 'UTC' : timezoneStore.zone,
		timeZoneName: 'short',
	});
}

/** Date-only companion to formatDateTime, e.g. 'Dec 15, 2024'. Follows the tz preference. */
export function formatDate(date: string | Date): string {
	return new Date(date).toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		timeZone: timezoneStore.zone,
	});
}

/**
 * Format an instant as a value for `<input type="datetime-local">` (`YYYY-MM-DDTHH:mm`),
 * showing the wall-clock time in `zone` (default: the browser's local zone). Use this to
 * seed/round-trip datetime-local inputs, seeding with a UTC wall-clock instead silently
 * shifts the value by the zone offset when the user accepts or edits it.
 */
export function toDatetimeLocal(value: string | number | Date, zone?: string): string {
	const d = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(d.getTime())) return '';
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: zone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
	}).formatToParts(d);
	const p: Record<string, string> = {};
	for (const part of parts) p[part.type] = part.value;
	return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function zoneOffsetMs(instant: Date, zone: string): number {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: zone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hourCycle: 'h23',
	}).formatToParts(instant);
	const p: Record<string, string> = {};
	for (const part of parts) p[part.type] = part.value;
	const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
	return asUtc - instant.getTime();
}

/**
 * Convert a naive `<input type="datetime-local">` value (`YYYY-MM-DDTHH:mm`), interpreted as
 * wall-clock time in `zone` (default: the browser's local zone), to a UTC ISO-8601 string for
 * the API. With the default zone this equals `new Date(naive).toISOString()`. (Non-existent
 * spring-forward wall-clock times resolve to one engine-defined side, a non-issue for
 * observation timestamps.)
 */
export function fromDatetimeLocal(naive: string, zone?: string): string {
	if (!naive) return '';
	if (!zone) return new Date(naive).toISOString();
	const wall = naive.length === 16 ? `${naive}:00` : naive;
	const guess = new Date(`${wall}Z`);
	return new Date(guess.getTime() - zoneOffsetMs(guess, zone)).toISOString();
}

export function statusBadgeClass(status: string): string {
	switch (status) {
		case 'completed': return 'bg-severity-ok-soft text-severity-ok';
		case 'failed': return 'bg-severity-alarm-soft text-severity-alarm';
		// `partial` is a cycle that finished with individual streams erroring, so it reads as a
		// warning even though the cycle itself did not fail.
		case 'partial': return 'bg-severity-warning-soft text-severity-warning font-semibold';
		case 'running':
		case 'retrying': return 'bg-severity-warning-soft text-severity-warning';
		case 'interrupted':
		case 'cancelled': return 'bg-severity-alarm-soft text-severity-alarm';
		default: return 'bg-brand-bg text-brand-muted';
	}
}

export function formatDurationMs(ms: number | null): string {
	if (ms == null) return '-';
	if (ms < 1000) return `${ms}ms`;
	const s = ms / 1000;
	if (s < 60) return `${s.toFixed(1)}s`;
	const m = Math.floor(s / 60);
	const rem = Math.round(s % 60);
	return `${m}m ${rem}s`;
}

/** Human-friendly cadence for a recurring schedule, e.g. 90 → "every 90s", 300 → "every 5m". */
export function formatInterval(seconds: number | null): string {
	if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return '-';
	if (seconds % 86400 === 0) return `every ${seconds / 86400}d`;
	if (seconds % 3600 === 0) return `every ${seconds / 3600}h`;
	if (seconds % 60 === 0) return `every ${seconds / 60}m`;
	return `every ${seconds}s`;
}

/**
 * The label for a job `detail.counts` key. The keys are the server-side identifiers the job bodies
 * write, so an unmapped one falls back to its de-underscored form rather than disappearing.
 */
export function countLabel(key: string): string {
	switch (key) {
		case 'readings_updated': return 'Readings updated';
		case 'readings_written': return 'Readings written';
		case 'readings_deleted': return 'Readings deleted';
		case 'readings_retagged': return 'Readings retagged';
		case 'samples_retagged': return 'Samples retagged';
		case 'families': return 'Replicate families';
		case 'migrated': return 'Families migrated';
		case 'already_migrated': return 'Already migrated';
		case 'skipped_unmigrated': return 'Skipped, not migrated';
		case 'preverify_failed': return 'Failed pre-verification';
		case 'verify_failed': return 'Failed verification';
		case 'cutover_failed': return 'Failed cutover';
		case 'awaiting_backfill': return 'Awaiting backfill';
		case 'old_stream_unpaired': return 'Legacy streams unpaired';
		case 'stray_member_streams': return 'Stray member streams';
		case 'streams_deleted': return 'Streams deleted';
		case 'replicate_groups': return 'Replicate groups';
		case 'slots': return 'Slots';
		case 'timestamps': return 'Timestamps';
		case 'inserted': return 'Inserted';
		case 'overwritten': return 'Overwritten';
		case 'recomposed': return 'Recomposed';
		case 'pruned': return 'Pruned';
		case 'reverted': return 'Reverted';
		case 'superseded': return 'Superseded';
		case 'filled': return 'Gaps filled';
		case 'gaps_found': return 'Gaps found';
		case 'events_written': return 'Alarm events written';
		case 'events_audited': return 'Events audited';
		case 'missing_findings': return 'Missing outputs found';
		case 'stale_findings': return 'Stale outputs found';
		case 'tools_run': return 'Tools run';
		case 'tools_skipped': return 'Tools skipped';
		case 'tools_unchanged': return 'Tools unchanged';
		case 'instant_decisions_skipped': return 'Instant decisions kept';
		case 'commands_queued': return 'Commands queued';
		case 'sync_events_pruned': return 'Sync events pruned';
		case 'ingest_receipts_pruned': return 'Ingest receipts pruned';
		case 'findings_closed': return 'Findings closed';
		case 'events_recomputed': return 'Visits recomputed';
		case 'events_in_scope': return 'Visits in scope';
		case 'merged_readings': return 'Readings merged';
		case 'merged_status_events': return 'Status events merged';
		case 'streams_updated': return 'Streams updated';
		case 'deployments_moved': return 'Deployments moved';
		case 'sites_merged': return 'Sites merged';
		case 'sites_reassigned': return 'Sites reassigned';
		case 'readings_moved': return 'Readings moved';
		case 'streams_paired': return 'Streams paired';
		case 'readings_backfilled': return 'Readings backfilled';
		case 'computed': return 'Values computed';
		case 'opened': return 'Alarms opened';
		case 'resolved': return 'Alarms resolved';
		case 'sync_events_closed': return 'Stale sync events closed';
		case 'channels_probed': return 'Channels probed';
		case 'channels': return 'Channels configured';
		case 'revoked': return 'Subscriptions revoked';
		case 'deactivated': return 'Subscriptions deactivated';
		case 'slots_failed': return 'Slots failed';
		default: {
			const words = key.replace(/_/g, ' ');
			return words.charAt(0).toUpperCase() + words.slice(1);
		}
	}
}

/** The System page's Jobs tab, opened on one job: where a notification about a job leads. */
// The statuses a job carries before it reaches a terminal one, matching the set the API
// treats as in flight in `reprocessing_jobs/service.rs`. A fresh enqueue is `queued` and a
// retryable failure goes back to it, so a panel that only knows `running` shows nothing for
// the whole backoff.
const ACTIVE_JOB_STATUSES = new Set(['queued', 'pending', 'running', 'retrying']);

export function isJobActive(status: string): boolean {
	return ACTIVE_JOB_STATUSES.has(status);
}

export function jobDetailPath(jobId: string): string {
	return `/system?tab=jobs&job=${encodeURIComponent(jobId)}`;
}

export function triggerLabel(triggerType: string): string {
	switch (triggerType) {
		case 'janitor_service': return 'Janitor sweep';
		case 'derived_recompute': return 'Derived recompute';
		case 'derived_assignment': return 'Derived assignment';
		case 'calibration_create': return 'Calibration added';
		case 'calibration_update': return 'Calibration update';
		case 'calibration_delete': return 'Calibration removed';
		case 'deployment_create': return 'Deployment added';
		case 'deployment_update': return 'Deployment update';
		case 'deployment_delete': return 'Deployment removed';
		case 'manual_reprocess': return 'Manual reprocess';
		case 'refresh_aggregates': return 'Aggregate refresh';
		case 'refresh_aggregates_full': return 'Full aggregate refresh';
		case 'compute_derived': return 'Compute derived';
		case 'csv_import': return 'CSV import';
		case 'pairing_backfill': return 'Pairing backfill';
		case 'plan_apply': return 'Applying pairing plan';
		case 'plan_revert': return 'Reverting pairing plan';
		case 'replicate_reconciliation': return 'Replicate migration';
		case 'replicate_reconciliation_delete': return 'Replicate migration cleanup';
		case 'event_recompute': return 'Visit recompute';
		// A job kind with no label of its own still reads as words rather than as its code.
		default: {
			const words = triggerType.replace(/_/g, ' ');
			return words.charAt(0).toUpperCase() + words.slice(1);
		}
	}
}

// A stored double as a reader can compare it: significant digits, trailing zeros dropped,
// exponential outside the range where a fixed form stays short.
export function formatSignificant(value: number, digits = 6): string {
	if (!Number.isFinite(value)) return '--';
	if (Number.isInteger(value) && Math.abs(value) < 1e6) return String(value);
	const abs = Math.abs(value);
	if (abs !== 0 && (abs < 1e-4 || abs >= 1e6)) return value.toExponential(3);
	return String(Number(value.toPrecision(digits)));
}

/** Short label per review-queue hold kind. The queue carries every kind, not just the statistics one. */
export function holdKindLabel(kind: string): string {
	switch (kind) {
		case 'replicate_stats': return 'statistics';
		case 'source_modified': return 'source modified';
		case 'brake_fired': return 'brake fired';
		case 'missing_output': return 'missing output';
		case 'stale_output': return 'stale output';
		case 'skipped_output': return 'skipped step';
		case 'curve_claim_stripped': return 'curve stripped';
		case 'unverified_entry': return 'entered, unverified';
		case 'unverified_visit': return 'field day pending';
		case 'source_identity_changed': return 'instrument changed';
		default: return kind.replace(/_/g, ' ');
	}
}

/** "3 statistics, 1 brake fired" for a per-kind pending count, most numerous first. */
export function holdKindBreakdown(byKind: Record<string, number>): string {
	return Object.entries(byKind)
		.filter(([, n]) => n > 0)
		.sort((a, b) => b[1] - a[1])
		.map(([kind, n]) => `${n} ${holdKindLabel(kind)}`)
		.join(', ');
}

/**
 * The one number to show for a run: `readings_updated` when the job reports it, otherwise the first
 * count it does report, otherwise the row's own `readings_updated` column. The column name predates
 * the jobs that count something other than readings, so it reads as "the number this run reports".
 */
export function headlineFor(job: {
	readings_updated: number | null;
	detail?: Record<string, unknown> | null;
}): { label: string; value: number } | null {
	const counts = (job.detail as { counts?: Record<string, unknown> } | null | undefined)?.counts;
	if (counts && typeof counts === 'object') {
		const entries = Object.entries(counts).filter(([, v]) => typeof v === 'number');
		const preferred = entries.find(([k]) => k === 'readings_updated') ?? entries[0];
		if (preferred) return { label: countLabel(preferred[0]), value: preferred[1] as number };
	}
	if (job.readings_updated != null)
		return { label: countLabel('readings_updated'), value: job.readings_updated };
	return null;
}
