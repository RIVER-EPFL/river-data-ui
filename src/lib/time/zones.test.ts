import { describe, expect, it } from 'vitest';

import { BROWSER_ZONE, entryZone, zoneOptions } from './zones';

describe('the zones a timestamp is entered in', () => {
	it('offers the browser zone, UTC and the lab zone first, and names the browser one', () => {
		const options = zoneOptions();
		const head = options.slice(0, 3).map((o) => o.value);
		expect(options[0].value).toBe(BROWSER_ZONE);
		expect(head).toContain('UTC');
		expect(head).toContain('Europe/Zurich');
		expect(options[0].label).toBe(`${BROWSER_ZONE} (here)`);
		// A pinned zone the browser also reports is offered once, not twice.
		expect(new Set(options.map((o) => o.value)).size).toBe(options.length);
	});

	it('reads a zone-free timestamp in the picked zone, whatever the display toggle says', () => {
		expect(entryZone('America/Santiago', 'UTC')).toBe('America/Santiago');
		expect(entryZone('America/Santiago', undefined)).toBe('America/Santiago');
	});

	it('falls back to the zone the display prints, so typing and reading back agree', () => {
		expect(entryZone(null, 'UTC')).toBe('UTC');
		expect(entryZone(null, undefined)).toBe(BROWSER_ZONE);
	});
});
