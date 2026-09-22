import { describe, expect, it } from 'vitest';
import { pipLabel } from './timeRangePips';

const MAX = Date.UTC(2026, 6, 2, 0, 0); // 2 July 2026, 00:00 UTC
const NOW = Date.UTC(2026, 6, 2, 0, 0);
const WIDE = { max: MAX, rangeDays: 30 };
const WEEK = { max: MAX, rangeDays: 5 };

const at = (hourUtc: number) => Date.UTC(2026, 6, 1, hourUtc, 0);

describe('pipLabel', () => {
	it('names the hour it prints, in the zone it prints it in', () => {
		// 10:00 UTC is 12:00 in Zurich; 12:00 UTC is 14:00 and carries no quarter-day mark there.
		expect(pipLabel(at(12), WIDE, 'UTC', NOW)).toBe('12:00');
		expect(pipLabel(at(10), WIDE, 'Europe/Zurich', NOW)).toBe('12:00');
		expect(pipLabel(at(12), WIDE, 'Europe/Zurich', NOW)).toBe('');
	});

	it('opens the day at the zone midnight, not at the UTC one', () => {
		// The Zurich day opens at 22:00 UTC the evening before.
		expect(pipLabel(at(22), WIDE, 'Europe/Zurich', NOW)).toBe('Jul 2');
		expect(pipLabel(at(0), WIDE, 'Europe/Zurich', NOW)).toBe('');
		expect(pipLabel(at(0), WIDE, 'UTC', NOW)).toBe('Jul 1');
	});

	it('marks the half day on a week-wide span and the quarter days only on a wider one', () => {
		expect(pipLabel(at(12), WEEK, 'UTC', NOW)).toBe('12:00');
		expect(pipLabel(at(6), WEEK, 'UTC', NOW)).toBe('');
		expect(pipLabel(at(6), WIDE, 'UTC', NOW)).toBe('6:00');
	});

	it('dates every tick further back than the last day', () => {
		const older = Date.UTC(2026, 5, 20, 6, 0);
		expect(pipLabel(older, WIDE, 'UTC', NOW)).toBe('Jun 20');
	});

	it('adds the year to a tick outside the year the reader is in', () => {
		expect(pipLabel(Date.UTC(2025, 5, 20, 6, 0), WIDE, 'UTC', NOW)).toBe('Jun 20, 2025');
	});

	it('prints the clock on a span under a day and the date on a span over two', () => {
		expect(pipLabel(at(12), { max: MAX, rangeDays: 0.5 }, 'UTC', NOW)).toBe('12:00 PM');
		expect(pipLabel(at(12), { max: MAX, rangeDays: 2 }, 'UTC', NOW)).toBe('Jul 1');
	});
});
