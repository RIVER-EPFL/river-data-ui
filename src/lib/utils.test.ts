import { describe, expect, it } from 'vitest';
import {
	dayBounds,
	dayOf,
	dayStart,
	formatCompactInstant,
	formatDate,
	formatDateTime,
	formatInstant,
	fromDatetimeLocal,
	isJobActive,
	jobDetailPath,
	toDatetimeLocal,
	triggerLabel,
	zoneLabel,
	zonedParts,
} from './utils';

const MS = Date.UTC(2026, 0, 15, 10, 30);

describe('formatInstant', () => {
	it('renders an instant exactly as the rest of the UI renders a date', () => {
		expect(formatInstant(MS)).toBe(formatDateTime(new Date(MS)));
	});

	it('labels the UTC instant when asked, whatever the preference says', () => {
		const utc = formatInstant(MS, { utc: true });
		expect(utc).toContain('UTC');
		expect(utc).toContain(formatDate(new Date(MS)).split(',')[0]);
	});
});

describe('job notifications', () => {
	it('names the pairing plan jobs rather than printing their trigger', () => {
		expect(triggerLabel('plan_apply')).toBe('Applying pairing plan');
		expect(triggerLabel('plan_revert')).toBe('Reverting pairing plan');
	});

	it('links a job to the tab that opens it, by id', () => {
		expect(jobDetailPath('3f1a')).toBe('/system?tab=jobs&job=3f1a');
	});
});

describe('isJobActive', () => {
	it('counts every status the API treats as in flight', () => {
		for (const status of ['queued', 'pending', 'running', 'retrying']) {
			expect(isJobActive(status)).toBe(true);
		}
	});

	it('does not count a terminal status', () => {
		for (const status of ['completed', 'failed', 'cancelled']) {
			expect(isJobActive(status)).toBe(false);
		}
	});

	it('does not count a status it has never heard of', () => {
		expect(isJobActive('paused')).toBe(false);
	});
});

describe('dayBounds', () => {
	it('resolves a calendar day as a half-open range in UTC', () => {
		expect(dayBounds('2026-07-01', 'UTC')).toEqual({
			start: '2026-07-01T00:00:00.000Z',
			end: '2026-07-02T00:00:00.000Z',
		});
	});

	it('resolves the same day in a positive-offset zone', () => {
		expect(dayBounds('2026-07-01', 'Europe/Zurich')).toEqual({
			start: '2026-06-30T22:00:00.000Z',
			end: '2026-07-01T22:00:00.000Z',
		});
	});

	it('gives a spring-forward day its 23 hours', () => {
		const day = dayBounds('2026-03-29', 'Europe/Zurich');
		expect(day).toEqual({
			start: '2026-03-28T23:00:00.000Z',
			end: '2026-03-29T22:00:00.000Z',
		});
	});

	it('crosses a month end', () => {
		expect(dayBounds('2026-02-28', 'UTC')?.end).toBe('2026-03-01T00:00:00.000Z');
	});

	it('has no bounds for an empty or malformed day', () => {
		expect(dayBounds('', 'UTC')).toBeUndefined();
		expect(dayBounds('2026-7-1', 'UTC')).toBeUndefined();
	});
});

describe('dayOf', () => {
	it('names the day an instant falls on in the zone asked for', () => {
		expect(dayOf('2026-07-01T23:30:00Z', 'UTC')).toBe('2026-07-01');
		expect(dayOf('2026-07-01T23:30:00Z', 'Europe/Zurich')).toBe('2026-07-02');
	});

	it('reads a half-open upper bound back as the day it closes', () => {
		const day = dayBounds('2026-07-01', 'Europe/Zurich');
		expect(dayOf(day?.end, 'Europe/Zurich', true)).toBe('2026-07-01');
		expect(dayOf(day?.start, 'Europe/Zurich')).toBe('2026-07-01');
	});

	it('names no day for a missing or unparseable instant', () => {
		expect(dayOf(undefined, 'UTC')).toBe('');
		expect(dayOf('not an instant', 'UTC')).toBe('');
	});
});

describe('formatCompactInstant', () => {
	it('prints a numeric wall clock in the zone it is given', () => {
		expect(formatCompactInstant('2025-08-26T08:30:45Z', 'UTC')).toBe('2025-08-26 08:30:45');
		expect(formatCompactInstant('2025-08-26T08:30:45Z', 'Europe/Zurich')).toBe('2025-08-26 10:30:45');
	});

	it('keeps a fraction the instant carries and drops one it does not', () => {
		expect(formatCompactInstant('2025-08-26T08:30:45.123Z', 'UTC')).toBe('2025-08-26 08:30:45.123');
		expect(formatCompactInstant('2025-08-26T08:30:45.000Z', 'UTC')).toBe('2025-08-26 08:30:45');
	});

	it('prints nothing for a value that is not an instant', () => {
		expect(formatCompactInstant('the day before', 'UTC')).toBe('');
	});
});

describe('zoneLabel', () => {
	it('names the zone it is given, and the browser zone for the local preference', () => {
		expect(zoneLabel('UTC')).toBe('UTC');
		expect(zoneLabel(undefined)).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
	});
});

describe('zonedParts', () => {
	it('resolves the wall clock in the zone, on both sides of a daylight-saving change', () => {
		// +02:00 in summer, +01:00 in winter.
		expect(zonedParts('2026-07-01T00:30:00Z', 'Europe/Zurich')).toEqual({
			year: 2026, month: 7, day: 1, hour: 2, minute: 30, second: 0,
		});
		expect(zonedParts('2026-12-31T23:30:00Z', 'Europe/Zurich')).toEqual({
			year: 2027, month: 1, day: 1, hour: 0, minute: 30, second: 0,
		});
	});

	it('resolves the same instant in UTC unshifted', () => {
		expect(zonedParts('2026-12-31T23:30:00Z', 'UTC')).toEqual({
			year: 2026, month: 12, day: 31, hour: 23, minute: 30, second: 0,
		});
	});
});

describe('dayStart', () => {
	it('opens the day at the zone midnight', () => {
		expect(dayStart('2026-07-01T10:00:00Z', 'UTC')).toBe(Date.parse('2026-07-01T00:00:00Z'));
		// Midsummer Zurich is +02:00, so its 1 July opens at 22:00 UTC on 30 June.
		expect(dayStart('2026-07-01T10:00:00Z', 'Europe/Zurich')).toBe(Date.parse('2026-06-30T22:00:00Z'));
	});

	it('reads an instant just before the zone midnight into the day before', () => {
		expect(dayStart('2026-06-30T22:30:00Z', 'Europe/Zurich')).toBe(Date.parse('2026-06-30T22:00:00Z'));
		expect(dayStart('2026-06-30T21:30:00Z', 'Europe/Zurich')).toBe(Date.parse('2026-06-29T22:00:00Z'));
	});
});

describe('fromDatetimeLocal', () => {
	it('reads a bare wall-clock time in the zone it is given', () => {
		expect(fromDatetimeLocal('2026-01-15T10:30', 'Europe/Zurich')).toBe('2026-01-15T09:30:00.000Z');
		expect(fromDatetimeLocal('2026-01-15T10:30', 'UTC')).toBe('2026-01-15T10:30:00.000Z');
	});

	it('keeps the meaning of a value that carries its own offset', () => {
		expect(fromDatetimeLocal('2026-01-15T10:30+02:00', 'Europe/Zurich')).toBe('2026-01-15T08:30:00.000Z');
		expect(fromDatetimeLocal('2026-01-15T10:30:00Z', 'America/Santiago')).toBe('2026-01-15T10:30:00.000Z');
	});

	it('resolves a nonexistent spring-forward wall time to one side, visibly', () => {
		// 02:30 on 2026-03-29 does not exist in Zurich: 02:00 CET jumps to 03:00 CEST.
		expect(fromDatetimeLocal('2026-03-29T02:30', 'Europe/Zurich')).toBe('2026-03-29T00:30:00.000Z');
	});

	it('resolves a repeated autumn wall time to the second occurrence', () => {
		// 02:30 on 2026-10-25 happens twice in Zurich; the later one is CET.
		expect(fromDatetimeLocal('2026-10-25T02:30', 'Europe/Zurich')).toBe('2026-10-25T01:30:00.000Z');
	});

	it('leaves the instant alone when the zone changes under it', () => {
		const instant = '2026-01-15T09:30:00.000Z';
		for (const zone of ['Europe/Zurich', 'UTC', 'America/Santiago', 'Pacific/Auckland']) {
			expect(fromDatetimeLocal(toDatetimeLocal(instant, zone), zone)).toBe(instant);
		}
	});
});
