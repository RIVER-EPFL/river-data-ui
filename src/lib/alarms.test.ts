import { describe, expect, it } from 'vitest';
import { alarmCauseLabel } from './alarms';

describe('alarmCauseLabel', () => {
	it('names an instrument-range breach', () => {
		expect(alarmCauseLabel('instrument_range')).toBe('Out of instrument range');
	});

	it('names a threshold breach', () => {
		expect(alarmCauseLabel('threshold')).toBe('Threshold');
	});

	it('reads an event that carries no kind as a threshold breach', () => {
		expect(alarmCauseLabel(null)).toBe('Threshold');
		expect(alarmCauseLabel(undefined)).toBe('Threshold');
	});
});
