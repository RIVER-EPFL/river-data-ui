import { base } from '$app/paths';

export type Severity = 'ok' | 'warning' | 'alarm' | 'unknown';

/** Normalizes numeric severity levels (1 = warning, 2+ = alarm) or strings to a Severity. */
export function severityFromLevel(level: number | string | null | undefined): Severity {
	if (typeof level === 'number') {
		if (level >= 2) return 'alarm';
		if (level >= 1) return 'warning';
		return 'ok';
	}
	switch (level) {
		case 'alarm':
		case 'warning':
		case 'ok':
			return level;
		default:
			return 'unknown';
	}
}

/**
 * Title-case severity label for UI text: 'Alarm' | 'Warning' | 'OK' | 'Unknown'.
 * Use everywhere a severity is named as a label (badges, table cells, tooltips).
 * Count phrases ("2 alarms") are ordinary sentences and stay lowercase.
 */
export function severityLabel(s: Severity | number): string {
	switch (typeof s === 'number' ? severityFromLevel(s) : s) {
		case 'alarm':
			return 'Alarm';
		case 'warning':
			return 'Warning';
		case 'ok':
			return 'OK';
		default:
			return 'Unknown';
	}
}

/** Badge variant (ui/Badge.svelte) for a severity. */
export function severityBadgeVariant(s: Severity | number): 'alarm' | 'warning' | 'ok' | 'muted' {
	switch (typeof s === 'number' ? severityFromLevel(s) : s) {
		case 'alarm':
			return 'alarm';
		case 'warning':
			return 'warning';
		case 'ok':
			return 'ok';
		default:
			return 'muted';
	}
}

/**
 * Threshold range notation, shared by every surface that prints threshold bounds:
 * one-sided ranges use comparators ('≥ 5', '≤ 10'), two-sided use an en dash ('5 – 10'),
 * and units are appended once ('5 – 10 mg/L'). Returns null when both bounds are null,
 * callers render their own muted 'None'.
 */
export function formatThresholdRange(
	min: number | null | undefined,
	max: number | null | undefined,
	units?: string | null,
): string | null {
	let range: string;
	if (min != null && max != null) range = `${min} – ${max}`;
	else if (min != null) range = `≥ ${min}`;
	else if (max != null) range = `≤ ${max}`;
	else return null;
	return units ? `${range} ${units}` : range;
}

export interface AlarmLinkTarget {
	site_id: string;
	parameter_id: string;
	started_at?: string | null;
	resolved_at?: string | null;
}

/**
 * Deep link to a site's charts, scrolled to the breaching parameter (`focus`) over the alarm's own
 * window. The window `[started_at, resolved_at ?? now]` is padded by half its duration on each side
 * (≥1h floor) so a long alarm opens with context either side and a brief blip still spans a couple of
 * hours instead of clipping to a single point. The site page consumes `start`/`end`/`focus` and
 * scrolls to that parameter's chart. Shared by the alarm log rows and the notification bell so both
 * land in the same place.
 */
export function alarmHref(a: AlarmLinkTarget): string {
	const endMs = (a.resolved_at ? new Date(a.resolved_at) : new Date()).getTime();
	const startMs = a.started_at ? new Date(a.started_at).getTime() : endMs;
	const pad = Math.max((endMs - startMs) * 0.5, 60 * 60 * 1000);
	const params = new URLSearchParams({
		start: new Date(startMs - pad).toISOString(),
		end: new Date(endMs + pad).toISOString(),
		focus: a.parameter_id,
	});
	return `${base}/sites/${a.site_id}?${params}`;
}
