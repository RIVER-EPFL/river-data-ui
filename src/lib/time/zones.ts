/** The zone the browser reports, the default a timestamp is read in. */
export const BROWSER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

const PINNED = [BROWSER_ZONE, 'UTC', 'Europe/Zurich'];

/** A fixed-offset entry, as its value is spelled: `UTC`, `UTC+02:00`, `UTC-05:30`. */
const FIXED = /^UTC(?:([+-])(\d{2}):(\d{2}))?$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
	let f = formatters.get(zone);
	if (!f) {
		f = new Intl.DateTimeFormat('en-CA', {
			timeZone: zone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hourCycle: 'h23',
		});
		formatters.set(zone, f);
	}
	return f;
}

/** The offset a fixed-offset entry applies, in minutes east of UTC; null for an IANA zone. */
export function fixedOffsetMinutes(value: string): number | null {
	const m = FIXED.exec(value);
	if (!m) return null;
	if (!m[1]) return 0;
	const minutes = Number(m[2]) * 60 + Number(m[3]);
	return m[1] === '-' ? -minutes : minutes;
}

/** The offset an IANA zone applies at `instant`, in minutes east of UTC. */
export function zoneOffsetMinutes(zone: string, instant: Date): number {
	const p: Record<string, string> = {};
	for (const part of formatterFor(zone).formatToParts(instant)) p[part.type] = part.value;
	const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
	return Math.round((asUtc - instant.getTime()) / 60000);
}

/** An offset as it is written beside a time: `UTC`, `UTC+2`, `UTC-3:30`. */
export function offsetLabel(minutes: number): string {
	if (minutes === 0) return 'UTC';
	const sign = minutes < 0 ? '-' : '+';
	const abs = Math.abs(minutes);
	const h = Math.floor(abs / 60);
	const m = abs % 60;
	return m === 0 ? `UTC${sign}${h}` : `UTC${sign}${h}:${String(m).padStart(2, '0')}`;
}

/**
 * Whether a zone is on summer time at `instant`: its offset there differs from the smaller of the
 * offsets it applies in January and July, which is its standard one either hemisphere.
 */
function onSummerTime(zone: string, instant: Date): boolean {
	const year = instant.getUTCFullYear();
	const january = zoneOffsetMinutes(zone, new Date(Date.UTC(year, 0, 15)));
	const july = zoneOffsetMinutes(zone, new Date(Date.UTC(year, 6, 15)));
	return zoneOffsetMinutes(zone, instant) > Math.min(january, july);
}

/** The instant a wall time lands on, for reading an entry's offset off the zone rules. */
function instantOf(wall: string | undefined): Date {
	if (wall) {
		const d = new Date(`${wall.length === 16 ? `${wall}:00` : wall}Z`);
		if (!Number.isNaN(d.getTime())) return d;
	}
	return new Date();
}

/** What a chosen entry applies to the wall time in the field. */
export function appliedOffset(value: string, wall?: string): { minutes: number; label: string; summer: boolean } {
	const fixed = fixedOffsetMinutes(value);
	if (fixed !== null) return { minutes: fixed, label: offsetLabel(fixed), summer: false };
	const at = instantOf(wall);
	// The wall time is read as if it were UTC, then again through the offset that first reading
	// suggests, so an instant within an hour of a transition resolves on the right side of it.
	const first = zoneOffsetMinutes(value, at);
	const minutes = zoneOffsetMinutes(value, new Date(at.getTime() - first * 60000));
	return { minutes, label: offsetLabel(minutes), summer: onSummerTime(value, new Date(at.getTime() - minutes * 60000)) };
}

/** The fixed-offset entries, UTC first, then east, then west. */
function fixedOffsets(): string[] {
	const pad = (n: number) => String(n).padStart(2, '0');
	const east = Array.from({ length: 14 }, (_, i) => `UTC+${pad(i + 1)}:00`);
	const west = Array.from({ length: 12 }, (_, i) => `UTC-${pad(i + 1)}:00`);
	return ['UTC', ...east, ...west];
}

export interface ZoneOption {
	value: string;
	label: string;
	/** The section the entry sits in, so a dropdown can group them. */
	group: 'offset' | 'pinned' | 'zone';
}

/**
 * The entries a timestamp input offers, for a wall time being typed: the fixed offsets first,
 * since the offset is what lands the instant in UTC and a logger set to one keeps it all year,
 * then the browser's zone, UTC and the lab's own, then every other IANA zone. A zone's label
 * carries the offset it applies at that wall time, so it moves with a summer-time transition.
 */
export function zoneOptions(wall?: string): ZoneOption[] {
	const all =
		typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
	const pinned = PINNED.filter((z, i) => PINNED.indexOf(z) === i && z !== 'UTC');
	const rest = all.filter((z) => !pinned.includes(z) && z !== 'UTC');
	const zone = (value: string, group: 'pinned' | 'zone'): ZoneOption => {
		const { label, summer } = appliedOffset(value, wall);
		const here = value === BROWSER_ZONE ? ' (here)' : '';
		return { value, group, label: `${value}${here}, ${label}${summer ? ' in summer time' : ''}` };
	};
	return [
		...fixedOffsets().map((value) => ({
			value,
			group: 'offset' as const,
			label: `${offsetLabel(fixedOffsetMinutes(value) ?? 0)}, no summer time`,
		})),
		...pinned.map((z) => zone(z, 'pinned')),
		...rest.map((z) => zone(z, 'zone')),
	];
}

/**
 * The zone a zone-free timestamp is read in: the one picked beside the field, else the zone it is
 * printed in, so what is typed and what comes back read the same until somebody says otherwise.
 */
export function entryZone(picked: string | null | undefined, display: string | undefined): string {
	return picked ?? display ?? BROWSER_ZONE;
}
