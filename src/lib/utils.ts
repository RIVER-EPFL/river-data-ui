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
		case 'running':
		case 'partial':
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
export function formatInterval(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return '-';
	if (seconds % 86400 === 0) return `every ${seconds / 86400}d`;
	if (seconds % 3600 === 0) return `every ${seconds / 3600}h`;
	if (seconds % 60 === 0) return `every ${seconds / 60}m`;
	return `every ${seconds}s`;
}

export function triggerLabel(triggerType: string): string {
	switch (triggerType) {
		case 'janitor_run': return 'Janitor sweep';
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
		case 'replicate_reconciliation': return 'Replicate migration';
		case 'replicate_reconciliation_delete': return 'Replicate migration cleanup';
		default: return triggerType;
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
