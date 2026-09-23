import { base } from '$app/paths';
import { api, type AlarmThreshold } from '$api/crud';

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

/**
 * The severity spelled out, with what is open behind it: the accessible name and title for any
 * surface that signals severity by colour alone.
 */
export function severityDescription(
	s: Severity | number,
	alarmCount = 0,
	warningCount = 0,
): string {
	const label = severityLabel(s);
	const parts: string[] = [];
	if (alarmCount > 0) parts.push(`${alarmCount} alarm${alarmCount === 1 ? '' : 's'}`);
	if (warningCount > 0) parts.push(`${warningCount} warning${warningCount === 1 ? '' : 's'}`);
	return `${label}: ${parts.length ? parts.join(', ') : 'no active alarms'}`;
}

/**
 * Threshold range notation, shared by every surface that prints threshold bounds:
 * one-sided ranges use comparators ('≥ 5', '≤ 10'), two-sided use an en dash ('5 – 10'),
 * and units are appended once ('5 – 10 mg/L'). Returns null when both bounds are null,
 * callers render their own muted 'None'.
 */
/**
 * The parameter's own bounds: its `alarm_thresholds` row with no site, which is what a site's own
 * row falls back to. Keyed by parameter id, for a list that renders many of them.
 */
export async function globalThresholdsByParameter(): Promise<Record<string, AlarmThreshold>> {
	const res = await api.alarmThresholds.list({ perPage: 500 });
	const out: Record<string, AlarmThreshold> = {};
	for (const t of res.data) {
		if (t.site_id === null && t.parameter_id) out[t.parameter_id] = t;
	}
	return out;
}

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

/**
 * What raised an alarm: the site or parameter thresholds, or a value outside what the instrument
 * that measured it can read. An older event carries no kind and reads as a threshold breach.
 */
export function alarmCauseLabel(kind: string | null | undefined): string {
	return kind === 'instrument_range' ? 'Out of instrument range' : 'Threshold';
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
