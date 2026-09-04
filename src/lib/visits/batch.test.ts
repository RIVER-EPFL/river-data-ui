import { describe, expect, it } from 'vitest';

import {
	batchParameters,
	batchVisits,
	inferLayout,
	parseBlock,
	readInstant,
	type ParameterColumn,
} from './batch';

const parameters: ParameterColumn[] = [
	{ parameterId: 'p-doc', code: 'DOC', name: 'DOC' },
	{ parameterId: 'p-ph', code: 'pH', name: 'pH' },
];

const sites = [
	{ id: 'site-fp1', name: 'FP1' },
	{ id: 'site-fp2', name: 'FP2' },
];

describe('the pasted block', () => {
	it('is a rectangle, padded where the sheet ends a row early', () => {
		expect(parseBlock('site\tdate\tDOC_1\nFP1\t2026-06-01\t120\nFP2\t2026-06-01\r\n')).toEqual([
			['site', 'date', 'DOC_1'],
			['FP1', '2026-06-01', '120'],
			['FP2', '2026-06-01', ''],
		]);
	});
});

describe('the layout a header row implies', () => {
	it('reads the site, the date and every replicate column', () => {
		const layout = inferLayout(['site', 'date', 'DOC_rep_1', 'DOC_rep_2', 'pH'], parameters);
		expect(layout.columns).toEqual([
			{ kind: 'site' },
			{ kind: 'collected_at' },
			{ kind: 'value', parameterId: 'p-doc', replicateIndex: 0 },
			{ kind: 'value', parameterId: 'p-doc', replicateIndex: 1 },
			{ kind: 'value', parameterId: 'p-ph', replicateIndex: 0 },
		]);
	});

	it('ignores a statistics column: a mean is computed, never pasted', () => {
		const layout = inferLayout(['DOC_avg', 'DOC_sd', 'DOC_1'], parameters);
		expect(layout.columns.map((c) => c.kind)).toEqual(['ignored', 'ignored', 'value']);
	});

	it('ignores a column naming nothing in the catalog rather than guessing', () => {
		expect(inferLayout(['operator', 'weather'], parameters).columns).toEqual([
			{ kind: 'ignored' },
			{ kind: 'ignored' },
		]);
	});
});

describe('a bare date cell', () => {
	it('is midnight UTC, and an unreadable cell is nothing', () => {
		expect(readInstant('2026-06-01')).toBe('2026-06-01T00:00:00.000Z');
		expect(readInstant('2026-06-01T07:30:00Z')).toBe('2026-06-01T07:30:00.000Z');
		expect(readInstant('last tuesday')).toBeNull();
		expect(readInstant('')).toBeNull();
	});
});

describe('the visits a block describes', () => {
	const block = parseBlock(
		[
			'site\tdate\tDOC_rep_1\tDOC_rep_2\tpH',
			'FP1\t2026-06-01\t120\t118\t7.4',
			'FP2\t2026-06-01\t\t\t7.1',
			'FP9\t2026-06-01\t100\t\t',
		].join('\n'),
	);
	const layout = inferLayout(block[0], parameters);

	it('is one per row, with a gap left where a repeat was not measured', () => {
		const visits = batchVisits(block, layout, sites);
		expect(visits).toHaveLength(3);
		expect(visits[0]).toEqual({
			site: 'FP1',
			siteId: 'site-fp1',
			collectedAt: '2026-06-01T00:00:00.000Z',
			values: [
				{ parameterId: 'p-doc', replicateIndex: 0, value: 120 },
				{ parameterId: 'p-doc', replicateIndex: 1, value: 118 },
				{ parameterId: 'p-ph', replicateIndex: 0, value: 7.4 },
			],
			problem: null,
		});
		expect(visits[1].values).toEqual([{ parameterId: 'p-ph', replicateIndex: 0, value: 7.1 }]);
	});

	it('names the row it cannot resolve rather than dropping it', () => {
		const visits = batchVisits(block, layout, sites);
		expect(visits[2].problem).toBe('no site called FP9');
		expect(batchParameters(visits)).toEqual(['p-doc', 'p-ph']);
	});

	it('says what is missing when a row carries no values or no date', () => {
		const thin = parseBlock('site\tdate\tDOC_1\nFP1\t2026-06-01\t\nFP2\tnot a date\t9');
		const visits = batchVisits(thin, inferLayout(thin[0], parameters), sites);
		expect(visits.map((v) => v.problem)).toEqual(['no values', 'no date read']);
	});
});
