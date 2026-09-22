import { zonedParts } from '$lib/utils';

/** How wide the slider's span is, which decides how dense its ticks are. */
export interface PipSpan {
	/** The instant at the right-hand end of the slider. */
	max: number;
	/** The whole span, in days. */
	rangeDays: number;
}

const LOCALE = 'en-US';

function shortDate(d: Date, zone: string | undefined, now: number): string {
	const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', timeZone: zone };
	if (zonedParts(d, zone).year !== zonedParts(now, zone).year) opts.year = 'numeric';
	return d.toLocaleDateString(LOCALE, opts);
}

/**
 * What a range slider's tick prints at `ms`: the day it opens, a quarter- or half-day hour inside
 * the last day of the span, or nothing. The hour a tick falls in is read in `zone`, the same zone
 * the label prints in, so the hour named is the hour shown.
 */
export function pipLabel(ms: number, span: PipSpan, zone?: string, now = Date.now()): string {
	const d = new Date(ms);
	if (span.rangeDays <= 2) {
		return span.rangeDays < 1
			? d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', timeZone: zone })
			: shortDate(d, zone, now);
	}
	if ((span.max - ms) / 3600000 > 24) return shortDate(d, zone, now);
	const { hour } = zonedParts(d, zone);
	if (hour === 0) return shortDate(d, zone, now);
	const marks = span.rangeDays > 8 ? [6, 12, 18] : [12];
	return marks.includes(hour) ? `${hour}:00` : '';
}
