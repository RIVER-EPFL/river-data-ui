import { base } from '$app/paths';

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
