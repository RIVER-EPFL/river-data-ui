import { describe, it, expect } from 'vitest';
import { kindOf, kindLabel, isBookkeeping, measuringInstruments } from './kind';

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
