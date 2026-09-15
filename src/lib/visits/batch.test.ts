import { describe, expect, it } from 'vitest';

import {
	batchParameters,
	batchVisits,
	inferLayout,
	parseBlock,
	readInstant,
	saveAll,
	type BatchVisit,
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

	it('reads the portal\'s other two spellings: a bare code, and a code with a number', () => {
		const layout = inferLayout(['DOC_1', 'DOC_2', 'pH'], parameters);
		expect(layout.columns).toEqual([
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
			unreadable: 0,
			problem: null,
		});
		expect(visits[1].values).toEqual([{ parameterId: 'p-ph', replicateIndex: 0, value: 7.1 }]);
	});

	it('names the row it cannot resolve rather than dropping it', () => {
		const visits = batchVisits(block, layout, sites);
		expect(visits[2].problem).toBe('no site called FP9');
		expect(batchParameters(visits)).toEqual(['p-doc', 'p-ph']);
	});

	// A sheet written with comma decimals reads as no numbers at all: without the count the row
	// saves short, or reports only that it held no values.
	it('counts the value cells it could not read and says so', () => {
		const commas = parseBlock('site\tdate\tDOC_1\tDOC_2\nFP1\t2026-06-01\t12,5\t13,1');
		const visits = batchVisits(commas, inferLayout(commas[0], parameters), sites);
		expect(visits[0].unreadable).toBe(2);
		expect(visits[0].problem).toBe('no values (2 cells were not numbers)');
	});

	it('names an unreadable cell on a row that still carries values', () => {
		const mixed = parseBlock('site\tdate\tDOC_1\tDOC_2\nFP1\t2026-06-01\t120\t13,1');
		const visits = batchVisits(mixed, inferLayout(mixed[0], parameters), sites);
		expect(visits[0].unreadable).toBe(1);
		expect(visits[0].problem).toBeNull();
	});

	it('says what is missing when a row carries no values or no date', () => {
		const thin = parseBlock('site\tdate\tDOC_1\nFP1\t2026-06-01\t\nFP2\tnot a date\t9');
		const visits = batchVisits(thin, inferLayout(thin[0], parameters), sites);
		expect(visits.map((v) => v.problem)).toEqual(['no values', 'no date read']);
	});
});

describe('saveAll', () => {
	function visit(site: string, problem: string | null = null): BatchVisit {
		return {
			site,
			siteId: problem === null ? `site-${site}` : null,
			collectedAt: '2026-06-01T00:00:00.000Z',
			values: [{ parameterId: 'p-doc', replicateIndex: 0, value: 1 }],
			unreadable: 0,
			problem,
		};
	}

	it('never sends a row that carries a problem, and says why', async () => {
		const sent: string[] = [];
		const results = await saveAll([visit('FP9', 'no site called FP9')], async (v) => {
			sent.push(v.site);
			return 'saved';
		});
		expect(sent).toEqual([]);
		expect(results).toEqual({ 0: 'not saved: no site called FP9' });
	});

	it('keeps saving after a row the API refuses', async () => {
		const sent: string[] = [];
		const results = await saveAll([visit('FP1'), visit('FP2'), visit('FP3')], async (v) => {
			sent.push(v.site);
			if (v.site === 'FP2') throw new Error('values not checked');
			return 'saved, visit created';
		});
		expect(sent).toEqual(['FP1', 'FP2', 'FP3']);
		expect(results).toEqual({
			0: 'saved, visit created',
			1: 'refused: values not checked',
			2: 'saved, visit created',
		});
	});

	it("keys the results by the block's own row order", async () => {
		const results = await saveAll(
			[visit('FP1'), visit('FP9', 'no date read'), visit('FP3')],
			async (v) => `saved ${v.site}`,
		);
		expect(Object.keys(results)).toEqual(['0', '1', '2']);
		expect(results[2]).toBe('saved FP3');
	});

	it('reports each row as it lands', async () => {
		const seen: [number, string][] = [];
		await saveAll(
			[visit('FP1'), visit('FP2')],
			async (v) => `saved ${v.site}`,
			(index, result) => seen.push([index, result]),
		);
		expect(seen).toEqual([
			[0, 'saved FP1'],
			[1, 'saved FP2'],
		]);
	});
});
