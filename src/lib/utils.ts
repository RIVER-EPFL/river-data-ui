import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

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
	return new Date(date).toLocaleDateString();
}

export function formatDateTime(date: string | Date): string {
	return new Date(date).toLocaleString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'UTC',
		timeZoneName: 'short',
	});
}

export function statusBadgeClass(status: string): string {
	switch (status) {
		case 'completed': return 'bg-severity-ok-soft text-severity-ok';
		case 'failed': return 'bg-severity-alarm-soft text-severity-alarm';
		case 'running':
		case 'partial':
		case 'retrying': return 'bg-severity-warning-soft text-severity-warning';
		default: return 'bg-brand-bg text-brand-muted';
	}
}

export function formatDurationMs(ms: number | null): string {
	if (ms == null) return '—';
	if (ms < 1000) return `${ms}ms`;
	const s = ms / 1000;
	if (s < 60) return `${s.toFixed(1)}s`;
	const m = Math.floor(s / 60);
	const rem = Math.round(s % 60);
	return `${m}m ${rem}s`;
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
		default: return triggerType;
	}
}
