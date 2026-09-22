import { describe, expect, it } from 'vitest';

import {
	BROWSER_ZONE,
	appliedOffset,
	entryZone,
	fixedOffsetMinutes,
	offsetLabel,
	zoneOffsetMinutes,
	zoneOptions
} from './zones';

// A July and a January instant in Zurich, either side of the summer-time transition.
const SUMMER = '2026-07-14T08:00';
const WINTER = '2026-01-14T08:00';

describe('the entries a timestamp is entered in', () => {
	it('offers the fixed offsets first, then the pinned zones, then the rest', () => {
		const options = zoneOptions(SUMMER);
		const groups = options.map((o) => o.group);
		expect(groups.indexOf('offset')).toBe(0);
		expect(groups.lastIndexOf('offset')).toBeLessThan(groups.indexOf('pinned'));
		expect(groups.lastIndexOf('pinned')).toBeLessThan(groups.indexOf('zone'));
		expect(options[0].value).toBe('UTC');
		expect(options.map((o) => o.value)).toContain('UTC+01:00');
		expect(options.map((o) => o.value)).toContain('UTC-05:00');
		expect(new Set(options.map((o) => o.value)).size).toBe(options.length);
	});

	it('says a fixed offset keeps its offset all year', () => {
		const utcPlusOne = zoneOptions(SUMMER).find((o) => o.value === 'UTC+01:00');
		expect(utcPlusOne?.label).toBe('UTC+1, no DST');
	});

	it('labels UTC with nothing beside it', () => {
		const utc = zoneOptions(SUMMER).find((o) => o.value === 'UTC');
		expect(utc?.label).toBe('UTC');
	});

	it('labels a zone with the offset it applies at the wall time in the field', () => {
		// The runner's own zone may be this one, which adds "(here)" between the two.
		const zurich = (wall: string) =>
			zoneOptions(wall)
				.find((o) => o.value === 'Europe/Zurich')
				?.label.replace(' (here)', '');
		expect(zurich(SUMMER)).toBe('Europe/Zurich, UTC+2 DST');
		expect(zurich(WINTER)).toBe('Europe/Zurich, UTC+1');
	});

	it('still names the browser zone', () => {
		const here = zoneOptions(SUMMER).find((o) => o.value === BROWSER_ZONE);
		expect(here?.label.startsWith(`${BROWSER_ZONE} (here)`)).toBe(true);
	});
});

describe('the offset an entry applies', () => {
	it('reads a fixed offset off its own name', () => {
		expect(fixedOffsetMinutes('UTC')).toBe(0);
		expect(fixedOffsetMinutes('UTC+02:00')).toBe(120);
		expect(fixedOffsetMinutes('UTC-05:30')).toBe(-330);
		expect(fixedOffsetMinutes('Europe/Zurich')).toBe(null);
	});

	it('writes an offset the way it is read beside a time', () => {
		expect(offsetLabel(0)).toBe('UTC');
		expect(offsetLabel(120)).toBe('UTC+2');
		expect(offsetLabel(-210)).toBe('UTC-3:30');
	});

	it('moves a zone with its summer-time transition', () => {
		expect(appliedOffset('Europe/Zurich', SUMMER)).toEqual({
			minutes: 120,
			label: 'UTC+2',
			summer: true
		});
		expect(appliedOffset('Europe/Zurich', WINTER)).toEqual({
			minutes: 60,
			label: 'UTC+1',
			summer: false
		});
	});

	it('applies a fixed offset whatever the date', () => {
		for (const wall of [SUMMER, WINTER]) {
			expect(appliedOffset('UTC+01:00', wall)).toEqual({
				minutes: 60,
				label: 'UTC+1',
				summer: false
			});
		}
	});

	it('reads a zone offset at an instant', () => {
		expect(zoneOffsetMinutes('UTC', new Date('2026-07-14T06:00:00Z'))).toBe(0);
		expect(zoneOffsetMinutes('Europe/Zurich', new Date('2026-07-14T06:00:00Z'))).toBe(120);
		expect(zoneOffsetMinutes('Europe/Zurich', new Date('2026-01-14T07:00:00Z'))).toBe(60);
	});
});

describe('the zone a zone-free timestamp is read in', () => {
	it('reads it in the picked zone, whatever the display toggle says', () => {
		expect(entryZone('America/Santiago', 'UTC')).toBe('America/Santiago');
		expect(entryZone('America/Santiago', undefined)).toBe('America/Santiago');
	});

	it('falls back to the zone the display prints, so typing and reading back agree', () => {
		expect(entryZone(null, 'UTC')).toBe('UTC');
		expect(entryZone(null, undefined)).toBe(BROWSER_ZONE);
	});
});
