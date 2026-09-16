import { describe, expect, it } from 'vitest';
import { nextRow, repeatedRows, type FieldDayRow } from './fieldDay';

describe('repeatedRows', () => {
	it('lets several sites share one time', () => {
		const rows: FieldDayRow[] = [
			{ site: 'a', when: '2026-06-03T09:10' },
			{ site: 'b', when: '2026-06-03T09:10' },
			{ site: 'a', when: '2026-06-03T14:00' },
		];
		expect(repeatedRows(rows)).toEqual([]);
	});

	it('names each repeat against its first row, ignoring rows not yet filled', () => {
		const rows: FieldDayRow[] = [
			{ site: 'a', when: '2026-06-03T09:10' },
			{ site: '', when: '2026-06-03T09:10' },
			{ site: 'a', when: '2026-06-03T09:10' },
			{ site: '', when: '2026-06-03T09:10' },
		];
		expect(repeatedRows(rows)).toEqual([[0, 2]]);
	});
});

describe('nextRow', () => {
	it('keeps the date of the last row and clears the site', () => {
		expect(nextRow({ site: 'a', when: '2026-06-03T09:10' }, 'fixed')).toEqual({
			site: 'fixed',
			when: '2026-06-03T09:10',
		});
		expect(nextRow({ site: 'a', when: '2026-06-03T09:10' }, null)).toEqual({
			site: '',
			when: '2026-06-03T09:10',
		});
	});
});
