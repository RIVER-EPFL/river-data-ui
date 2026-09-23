import { describe, expect, it } from 'vitest';
import { RANGE_MS, activePreset, presetWindow } from './rangePresets';

const END = Date.parse('2026-09-23T12:00:00Z');

describe('presetWindow', () => {
	it('ends at the given instant and spans the preset', () => {
		expect(presetWindow('7d', END)).toEqual({ start: END - 7 * 86_400_000, end: END });
		expect(presetWindow('24h', END).start).toBe(Date.parse('2026-09-22T12:00:00Z'));
	});

	it('starts no earlier than the lower bound', () => {
		const min = END - 10 * 86_400_000;
		expect(presetWindow('30d', END, min)).toEqual({ start: min, end: END });
		expect(presetWindow('7d', END, min).start).toBe(END - RANGE_MS['7d']);
	});
});

describe('activePreset', () => {
	it('names the preset a window spans', () => {
		expect(activePreset(END - RANGE_MS['90d'], END)).toBe('90d');
		// 30 s short of a day is still a day
		expect(activePreset(END - RANGE_MS['24h'] + 30_000, END)).toBe('24h');
	});

	it('is null for a window no preset spans', () => {
		expect(activePreset(END - 2 * 86_400_000, END)).toBeNull();
		expect(activePreset(END, END)).toBeNull();
	});
});
