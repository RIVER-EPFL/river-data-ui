import { describe, expect, it } from 'vitest';

import type { VisitRow } from '$api/service';
import {
	gridRows,
	saveLabel,
	keptAfterSave,
	namedInstants,
	racedRows,
	savedLine,
	spareCount,
	standingInstants,
	spareNotice,
	spareVisits,
	stagedLabel,
	staging,
	writableEdits,
} from './spareRows';

function visit(id: string, collectedAt: string): VisitRow {
	return {
		id,
		collected_at: collectedAt,
		cells: [],
		source: 'manual',
		recompute: 'current',
		parameters_filled: 0,
		findings_open: 0,
		unverified: false,
	};
}

const listed = [visit('v1', '2026-07-01T08:00:00Z'), visit('v2', '2026-07-02T08:00:00Z')];
const standing = standingInstants(listed);

describe('the spare rows under the last visit', () => {
	it('stages a visit at the date a row names, a bare date at midnight UTC', () => {
		const [row] = spareVisits({ 'new:0': '2026-07-05' }, 1, standing, 'UTC');
		expect(row.collectedAt).toBe('2026-07-05T00:00:00.000Z');
		expect(row.problem).toBeNull();
		const [stamped] = spareVisits({ 'new:0': '2026-07-05T14:30:00Z' }, 1, standing, 'UTC');
		expect(stamped.collectedAt).toBe('2026-07-05T14:30:00.000Z');
	});

	it('reads a typed date as wall clock in the zone the date column prints', () => {
		const [zurich] = spareVisits({ 'new:0': '2026-07-05' }, 1, standing, 'Europe/Zurich');
		// Midsummer in Zurich is UTC+2, so the day starts at 22:00 the evening before.
		expect(zurich.collectedAt).toBe('2026-07-04T22:00:00.000Z');
		// A value carrying its own offset means one instant whatever zone is named beside it.
		const [fixed] = spareVisits({ 'new:0': '2026-07-05T08:00:00Z' }, 1, standing, 'Europe/Zurich');
		expect(fixed.collectedAt).toBe('2026-07-05T08:00:00.000Z');
	});

	it('says the UTC instant a staged row resolved to, so a zone is read off the grid', () => {
		const [row] = spareVisits({ 'new:0': '2026-07-05' }, 1, standing, 'America/Santiago');
		// Winter in Santiago is UTC-4, so the day starts at 04:00 UTC.
		expect(row.collectedAt).toBe('2026-07-05T04:00:00.000Z');
		expect(stagedLabel(row.collectedAt as string)).toBe('new visit at 2026-07-05 04:00:00Z');
	});

	it('leaves a row nobody has typed into waiting, neither staging nor refusing', () => {
		const [row] = spareVisits({}, 1, standing, 'UTC');
		expect(row).toEqual({ id: 'new:0', typed: '', collectedAt: null, problem: null });
	});

	it('refuses a date it cannot read, and names what was typed', () => {
		const [row] = spareVisits({ 'new:0': 'last thursday' }, 1, standing, 'UTC');
		expect(row.collectedAt).toBeNull();
		expect(row.problem).toBe('last thursday is not a date');
	});

	it('refuses a date a listed visit already stands at rather than joining it', () => {
		const [row] = spareVisits({ 'new:0': '2026-07-02T08:00:00Z' }, 1, standing, 'UTC');
		expect(row.collectedAt).toBeNull();
		expect(row.problem).toBe('a visit already stands at 2026-07-02T08:00:00Z');
	});

	it('refuses the second of two rows naming one instant, and keeps the first', () => {
		const rows = spareVisits({ 'new:0': '2026-07-05', 'new:1': '2026-07-05T00:00:00Z' }, 2, standing, 'UTC');
		expect(rows[0].collectedAt).toBe('2026-07-05T00:00:00.000Z');
		expect(rows[1].problem).toBe('another new row names 2026-07-05T00:00:00Z');
	});

	it('draws one empty row under the last one in use, and however many more were asked for', () => {
		expect(spareCount({}, {}, 1)).toBe(1);
		expect(spareCount({ 'new:0': '2026-07-05' }, {}, 1)).toBe(2);
		// A pasted block runs down the spare area; every row it reached keeps its place.
		expect(spareCount({}, { 'new:4|p-do|0': '8.1' }, 1)).toBe(6);
		expect(spareCount({}, {}, 3)).toBe(3);
	});

	it('puts the spare rows under the listed visits, each carrying the instant it stages', () => {
		const spares = spareVisits({ 'new:0': '2026-07-05' }, 2, standing, 'UTC');
		const rows = gridRows(listed, spares);
		expect(rows.map((r) => r.id)).toEqual(['v1', 'v2', 'new:0', 'new:1']);
		expect(rows[2].collected_at).toBe('2026-07-05T00:00:00.000Z');
		expect(rows[3].collected_at).toBe('');
		expect(staging(spares)).toEqual([{ id: 'new:0', collectedAt: '2026-07-05T00:00:00.000Z' }]);
	});

	it('writes what was typed on a staging row and nothing typed on a refused one', () => {
		const spares = spareVisits({ 'new:0': '2026-07-05', 'new:1': 'not a date' }, 2, standing, 'UTC');
		const edits = { 'v1|p-do|0': '7', 'new:0|p-do|0': '8.5', 'new:1|p-do|0': '9.1' };
		expect(writableEdits(edits, spares)).toEqual({ 'v1|p-do|0': '7', 'new:0|p-do|0': '8.5' });
	});

	it('says what the spare area refused, and when values were typed with no date beside them', () => {
		const spares = spareVisits({ 'new:0': 'not a date' }, 2, standing, 'UTC');
		expect(spareNotice(spares, { 'new:1|p-do|0': '9.1' })).toBe(
			'not a date is not a date. 1 new row holds values with no date.',
		);
		expect(spareNotice(spareVisits({}, 1, standing, 'UTC'), {})).toBeNull();
	});

	it('refuses a date standing at the site but off the listed page', () => {
		// The grid is paged to July; the visit the paste names is in September.
		const offScreen = standingInstants(listed, ['2026-09-17T10:00:00Z']);
		const [row] = spareVisits({ 'new:0': '2026-09-17T10:00:00Z' }, 1, offScreen, 'UTC');
		expect(row.collectedAt).toBeNull();
		expect(row.problem).toBe('a visit already stands at 2026-09-17T10:00:00Z');
	});

	it('names the instants a lookup has to ask about, whatever already stands', () => {
		const typed = { 'new:0': '2026-07-02T08:00:00Z', 'new:1': '2026-07-05', 'new:2': 'no' };
		// The first is a listed visit's own instant, and the lookup asks about it all the same.
		expect(namedInstants(typed, 3, 'UTC')).toEqual([
			'2026-07-02T08:00:00.000Z',
			'2026-07-05T00:00:00.000Z',
		]);
	});

	it('names the rows a stage found already standing, and keeps what they hold', () => {
		const spares = spareVisits({ 'new:0': '2026-07-05', 'new:1': '2026-07-06' }, 2, standing, 'UTC');
		const raced = racedRows(spares, [
			{ collected_at: '2026-07-05T00:00:00Z', created: false },
			{ collected_at: '2026-07-06T00:00:00Z', created: true },
		]);
		expect([...raced]).toEqual(['new:0']);

		const kept = keptAfterSave(
			{ 'v1|p-do|0': '7', 'new:0|p-do|0': '8.5', 'new:1|p-do|0': '9.1' },
			{ 'new:0': '2026-07-05', 'new:1': '2026-07-06' },
			raced,
		);
		expect(kept.edits).toEqual({ 'new:0|p-do|0': '8.5' });
		expect(kept.dates).toEqual({ 'new:0': '2026-07-05' });
	});

	it('counts the visits a save opens beside the values it moves', () => {
		expect(saveLabel(3, 2)).toBe('Save 3 values and 2 new visits');
		expect(saveLabel(1, 0)).toBe('Save 1 value');
		expect(saveLabel(0, 1)).toBe('Save 0 values and 1 new visit');
		expect(saveLabel(0, 0)).toBe('Save 0 values');
		expect(savedLine(3, 1)).toBe('3 values and 1 new visit saved');
	});
});
