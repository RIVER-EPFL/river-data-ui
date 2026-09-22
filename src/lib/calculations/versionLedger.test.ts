import { describe, expect, it } from 'vitest';

import { ledgerHref, ledgerLines } from './versionLedger';

const row = (overrides: Record<string, unknown> = {}) => ({
	version_id: 'v1',
	version_no: 3,
	readings: 12,
	first_instant: '2026-01-01T00:00:00Z',
	last_instant: '2026-02-01T00:00:00Z',
	first_computed: '2026-01-01T01:00:00Z',
	last_computed: '2026-02-01T01:00:00Z',
	...overrides,
});

const outputs = [
	{ parameterId: 'p-suva', code: 'suva' },
	{ parameterId: 'p-doc', code: 'doc' },
];

describe('ledgerLines', () => {
	it('links each output to its readings over the span the version wrote at', () => {
		const [line] = ledgerLines([row()], outputs, '');
		expect(line.versionNo).toBe(3);
		expect(line.readings).toBe(12);
		expect(line.links.map((l) => l.code)).toEqual(['suva', 'doc']);
		expect(line.links[0].href).toBe(
			'/readings?parameter=p-suva&from=2026-01-01T00%3A00%3A00Z&to=2026-02-01T00%3A00%3A00Z',
		);
	});

	it('keeps the row of a version that wrote nothing, and gives it no links', () => {
		const [line] = ledgerLines(
			[row({ readings: 0, first_instant: null, last_instant: null })],
			outputs,
			'',
		);
		expect(line.readings).toBe(0);
		expect(line.span).toBeNull();
		expect(line.links).toEqual([]);
	});

	it('honours the base path', () => {
		expect(
			ledgerHref('/app', 'p-suva', { from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z' }),
		).toMatch(/^\/app\/readings\?/);
	});
});
