import { describe, it, expect } from 'vitest';
import { inUseCell, kindOf, kindLabel, isBookkeeping, measuringInstruments } from './kind';

const sensor = (kind: string | undefined, is_lab_instrument = false) =>
	({ kind, is_lab_instrument }) as never;

describe('instrument kinds', () => {
	it('names each kind', () => {
		expect(kindLabel(sensor('device'))).toBe('Field');
		expect(kindLabel(sensor('lab'))).toBe('Lab');
		expect(kindLabel(sensor('source_parameter'))).toBe('Source parameter');
		expect(kindLabel(sensor('entry_channel'))).toBe('Entry channel');
	});

	it('falls back to the lab flag for a row from an API that predates the column', () => {
		expect(kindOf(sensor(undefined, true))).toBe('lab');
		expect(kindOf(sensor(undefined, false))).toBe('device');
	});

	it('offers only what something could have been measured on', () => {
		expect(isBookkeeping(sensor('device'))).toBe(false);
		expect(isBookkeeping(sensor('lab'))).toBe(false);
		expect(isBookkeeping(sensor('source_parameter'))).toBe(true);
		expect(isBookkeeping(sensor('entry_channel'))).toBe(true);
		expect(
			measuringInstruments([sensor('device'), sensor('entry_channel'), sensor('lab')])
		).toHaveLength(2);
	});
});

describe('inUseCell', () => {
	const relative = (iso: string) => `rel:${iso}`;
	const row = (over: Record<string, unknown>) => over as never;

	it('gives a device its deployment, and says so when it has none', () => {
		expect(inUseCell(row({ kind: 'device' }), '2025-06-01T00:00:00Z', relative).text).toBe(
			'rel:2025-06-01T00:00:00Z'
		);
		expect(inUseCell(row({ kind: 'device' }), null, relative).text).toBe('Undeployed');
	});

	it('gives a lab instrument its last curve use, which a deployment date never says', () => {
		const cell = inUseCell(
			row({ kind: 'lab', curve_count: 2, last_curve_use: '2025-07-04T09:00:00Z' }),
			null,
			relative
		);
		expect(cell.text).toBe('rel:2025-07-04T09:00:00Z');
		expect(cell.title).toContain('2 curves');
	});

	it('separates a lab instrument with unused curves from one with none', () => {
		expect(inUseCell(row({ kind: 'lab', curve_count: 3 }), null, relative).text).toBe('Unused');
		expect(inUseCell(row({ kind: 'lab', curve_count: 0 }), null, relative).text).toBe('No curves');
	});

	it('says the column does not apply to a bookkeeping row', () => {
		for (const kind of ['source_parameter', 'entry_channel']) {
			const cell = inUseCell(row({ kind, curve_count: 1 }), null, relative);
			expect(cell.text).toBe('—');
			expect(cell.title).toContain('Nothing was measured on it');
		}
	});

	it('falls back to the flag for a row predating the backfill', () => {
		expect(inUseCell(row({ is_lab_instrument: true, curve_count: 0 }), null, relative).text).toBe(
			'No curves'
		);
		expect(inUseCell(row({ is_lab_instrument: false }), null, relative).text).toBe('Undeployed');
	});
});
