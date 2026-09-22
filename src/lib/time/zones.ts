/** The zone the browser reports, the default a timestamp is read in. */
export const BROWSER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

const PINNED = [BROWSER_ZONE, 'UTC', 'Europe/Zurich'];

/**
 * The zone list a timestamp input offers: the browser's zone, UTC and the lab's own zone first,
 * then every IANA zone the engine knows.
 */
export function zoneOptions(): { value: string; label: string }[] {
	const all =
		typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
	const pinned = PINNED.filter((z, i) => PINNED.indexOf(z) === i);
	const rest = all.filter((z) => !pinned.includes(z));
	return [...pinned, ...rest].map((value) => ({
		value,
		label: value === BROWSER_ZONE ? `${value} (here)` : value,
	}));
}
