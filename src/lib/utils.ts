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
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
	if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
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
