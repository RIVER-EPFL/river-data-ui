import { describe, expect, it } from 'vitest';
import { DEFAULT_WINDOW_MS, initialChartRange, type ParameterExtent } from './initialRange';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 1);

const spot = (startMs: number, endMs: number): ParameterExtent => ({
	data_start: new Date(startMs).toISOString(),
	data_end: new Date(endMs).toISOString(),
	reading_count: 7,
	has_spot: true,
	frequency: 'low',
});

const continuous = (startMs: number, endMs: number): ParameterExtent => ({
	data_start: new Date(startMs).toISOString(),
	data_end: new Date(endMs).toISOString(),
	reading_count: 10_000,
	has_continuous: true,
	frequency: 'high',
});

describe('initialChartRange', () => {
	it('opens a spot-only site on the span its grabs cover, not the last week', () => {
		const extents = [spot(NOW - 90 * DAY, NOW)];
		const range = initialChartRange(extents, { minMs: NOW - 90 * DAY, maxMs: NOW }, 'all');
		expect(range).toEqual({ startMs: NOW - 90 * DAY, endMs: NOW });
	});

	it('keeps the last week for the high cadence', () => {
		const extents = [continuous(NOW - 90 * DAY, NOW), spot(NOW - 90 * DAY, NOW)];
		const range = initialChartRange(extents, { minMs: NOW - 90 * DAY, maxMs: NOW }, 'high');
		expect(range).toEqual({ startMs: NOW - DEFAULT_WINDOW_MS, endMs: NOW });
	});

	it('opens the low cadence on the spot span even where continuous data is present', () => {
		const extents = [continuous(NOW - 90 * DAY, NOW), spot(NOW - 60 * DAY, NOW - 30 * DAY)];
		const range = initialChartRange(extents, { minMs: NOW - 90 * DAY, maxMs: NOW }, 'low');
		expect(range).toEqual({ startMs: NOW - 60 * DAY, endMs: NOW - 30 * DAY });
	});

	it('keeps the week on a mixed site whose continuous data reaches into it', () => {
		const extents = [continuous(NOW - 90 * DAY, NOW), spot(NOW - 90 * DAY, NOW - 40 * DAY)];
		const range = initialChartRange(extents, { minMs: NOW - 90 * DAY, maxMs: NOW }, 'all');
		expect(range).toEqual({ startMs: NOW - DEFAULT_WINDOW_MS, endMs: NOW });
	});

	it('falls back to the spot span when the week holds no continuous data', () => {
		const extents = [continuous(NOW - 90 * DAY, NOW - 30 * DAY), spot(NOW - 80 * DAY, NOW)];
		const range = initialChartRange(extents, { minMs: NOW - 90 * DAY, maxMs: NOW }, 'all');
		expect(range).toEqual({ startMs: NOW - 80 * DAY, endMs: NOW });
	});

	it('never returns a zero-width window for a single-instant site', () => {
		const extents = [spot(NOW, NOW)];
		const range = initialChartRange(extents, { minMs: NOW, maxMs: NOW }, 'all');
		expect(range.endMs - range.startMs).toBe(DEFAULT_WINDOW_MS);
	});

	it('falls back to the week when nothing reports an extent', () => {
		const range = initialChartRange([], { minMs: NOW - 30 * DAY, maxMs: NOW }, 'all');
		expect(range).toEqual({ startMs: NOW - DEFAULT_WINDOW_MS, endMs: NOW });
	});
});
