import { describe, expect, it } from 'vitest';
import {
	RECOMPUTE_BADGE,
	calculationFindings,
	changedPayload,
	inputsWithoutValue,
	computing,
	movedOutputs,
	runOutputs,
	readUntilSettled,
	recomputeFixable,
	runReportLine,
	visitBadge,
	visitCalculationBadge,
	visitSourceLabel,
} from './recompute';

describe('visitBadge', () => {
	it('reads the recompute state alone', () => {
		expect(visitBadge('stale')).toEqual(RECOMPUTE_BADGE.stale);
		expect(visitBadge('current')).toBeNull();
		expect(visitBadge(undefined)).toBeNull();
	});
});

describe('computing', () => {
	it('is true only while the outputs are still being written', () => {
		expect(computing('queued')).toBe(true);
		expect(computing('running')).toBe(true);
		expect(computing('stale')).toBe(false);
		expect(computing(undefined)).toBe(false);
	});
});

describe('visitSourceLabel', () => {
	it('names the portal, or the person who typed the values', () => {
		expect(visitSourceLabel('portal_sync')).toBe('Synced from the portal');
		expect(visitSourceLabel('portal_sync', 'aline')).toBe('Synced from the portal');
		expect(visitSourceLabel('manual', 'aline')).toBe('Entered manually by aline');
		expect(visitSourceLabel('manual')).toBe('Entered manually');
		expect(visitSourceLabel(undefined, null)).toBe('Entered manually');
	});
});

describe('what the bar reports once the calculations have run', () => {
	const doc = { label: 'DOC', outputs: [{ parameter_code: 'DOC_avg' }] };
	const suva = { label: 'SUVA', outputs: [{ parameter_code: 'SUVA' }] };

	it('names the outputs that moved, with the value on each side', () => {
		const outputs = runOutputs([doc, suva], { DOC_avg: 1.2, SUVA: 2 }, { DOC_avg: 1.4, SUVA: 2 });
		expect(movedOutputs(outputs).map((o) => o.code)).toEqual(['DOC_avg']);
		expect(runReportLine(outputs)).toBe('1 calculation ran: DOC_avg 1.2 → 1.4; SUVA unchanged.');
	});

	it('gives the reason for an output that did not run', () => {
		const outputs = runOutputs([suva], { SUVA: 2 }, { SUVA: 2 }, { SUVA: 'skipped_output' });
		expect(runReportLine(outputs)).toBe('No output moved: SUVA did not run (skipped output).');
	});

	it('counts an output that had no value before as moved', () => {
		const outputs = runOutputs([doc], {}, { DOC_avg: 1.4 });
		expect(runReportLine(outputs)).toBe('1 calculation ran: DOC_avg no value → 1.4.');
	});

	it('says nothing when no calculation reads what was saved', () => {
		expect(runReportLine(runOutputs([], {}, {}))).toBeNull();
	});
});

describe('readUntilSettled', () => {
	const rows = (...states: string[]) => states.map((recompute) => ({ recompute }));

	it('keeps reading while a visit is queued or running, and returns the settled read', async () => {
		const reads = [rows('current', 'queued'), rows('running', 'current'), rows('current', 'current')];
		let calls = 0;
		const waits: number[] = [];
		const settled = await readUntilSettled(async () => reads[calls++], {
			intervalMs: 500,
			timeoutMs: 10_000,
			wait: async (ms) => {
				waits.push(ms);
			},
		});
		expect(settled).toBe(true);
		expect(calls).toBe(3);
		expect(waits).toEqual([500, 500]);
	});

	it('reads once when nothing is outstanding', async () => {
		let calls = 0;
		const settled = await readUntilSettled(async () => (calls++, rows('current', 'stale', 'failed')), {
			wait: async () => {},
		});
		expect(settled).toBe(true);
		expect(calls).toBe(1);
	});

	it('gives up after the timeout and says the run had not settled', async () => {
		let calls = 0;
		const settled = await readUntilSettled(async () => (calls++, rows('queued')), {
			intervalMs: 1_000,
			timeoutMs: 3_000,
			wait: async () => {},
		});
		expect(settled).toBe(false);
		// the first read, then one per interval until 3 s have been waited
		expect(calls).toBe(4);
	});
});

describe('badge titles', () => {
	it('says what each recompute state means and what to do about it', () => {
		for (const state of ['queued', 'running', 'failed', 'stale']) {
			expect(RECOMPUTE_BADGE[state].title.length).toBeGreaterThan(0);
		}
		expect(RECOMPUTE_BADGE.failed.title).toContain('Jobs');
		expect(RECOMPUTE_BADGE.stale.title).toContain('recompute');
	});
});

describe('changedPayload', () => {
	it('is null for a listing equal to the one held and its text otherwise', () => {
		const listing = { visits: [{ id: 'v1', recompute: 'queued' }] };
		const held = changedPayload(null, listing);
		expect(held).toBe(JSON.stringify(listing));
		expect(changedPayload(held, { visits: [{ id: 'v1', recompute: 'queued' }] })).toBeNull();
		expect(changedPayload(held, { visits: [{ id: 'v1', recompute: 'current' }] })).not.toBeNull();
	});
});

describe('calculationFindings', () => {
	const cell = (code: string, kind?: string, tool?: string, writtenBy?: string) => ({
		parameter_id: `p-${code}`,
		parameter_code: code,
		written_by: writtenBy,
		finding: kind ? { kind, tool } : undefined,
	});

	it('groups the findings by calculation and names each kind', () => {
		const chips = calculationFindings([
			cell('pco2', 'skipped_output', 'pco2real'),
			cell('pco2_sat', 'skipped_output', 'pco2real'),
			cell('abstar', 'stale_output', 'ABstar'),
			cell('temp'),
		]);
		expect(chips.map((c) => c.label)).toEqual([
			'ABstar out of date (1)',
			"pco2real can't compute: inputs missing (2)",
		]);
		expect(chips[1].parameterIds).toEqual(['p-pco2', 'p-pco2_sat']);
	});

	it('says stale only for a stale output, and not computed yet for a missing one', () => {
		const [stale] = calculationFindings([cell('a', 'stale_output', 'ABstar')]);
		expect(stale.variant).toBe('warning');
		expect(stale.title).toMatch(/Recompute/);
		const [missing] = calculationFindings([cell('a', 'missing_output', 'ABstar')]);
		expect(missing.label).toBe('ABstar not computed yet (1)');
		expect(missing.title).toMatch(/Recompute/);
	});

	it('marks a skip as a note naming the inputs to enter, not a warning', () => {
		const [skipped] = calculationFindings([cell('pco2', 'skipped_output', 'pco2real')], (c) =>
			c === 'pco2real' ? ['alk', 'ph'] : [],
		);
		expect(skipped.variant).toBe('muted');
		expect(skipped.title).toContain('alk, ph');
		expect(skipped.title).not.toMatch(/Recompute/);
	});

	it('says a raised script failed, with its message, rather than missing inputs', () => {
		const [failed] = calculationFindings([
			{
				parameter_id: 'p-b',
				parameter_code: 'b',
				finding: { kind: 'skipped_output', tool: 'chain_b', cause: 'error', reason: 'script error: division by zero' },
			},
		]);
		expect(failed.label).toBe('chain_b failed: division by zero (1)');
		expect(failed.variant).toBe('alarm');
		expect(failed.title).not.toMatch(/inputs are missing/);
	});

	it('names the step a skip waits on', () => {
		const [waiting] = calculationFindings([
			{
				parameter_id: 'p-c',
				parameter_code: 'c',
				finding: { kind: 'skipped_output', tool: 'chain_c', cause: 'upstream', waits_on: 'chain_b' },
			},
		]);
		expect(waiting.label).toBe('chain_c waits on chain_b (1)');
		expect(waiting.title).toContain('chain_b');
	});

	it('says a run that gave no value only that, with its reason on hover', () => {
		const [none] = calculationFindings([
			{
				parameter_id: 'p-p',
				parameter_code: 'pco2',
				finding: { kind: 'skipped_output', tool: 'pco2real', cause: 'unknown', reason: 'run produced no savable output' },
			},
		]);
		expect(none.label).toBe('pco2real gave no value (1)');
		expect(none.title).toContain('run produced no savable output');
	});

	it('keeps two causes on one calculation apart', () => {
		const chips = calculationFindings([
			{ parameter_id: 'a', parameter_code: 'a', finding: { kind: 'skipped_output', tool: 'x', cause: 'inputs' } },
			{ parameter_id: 'b', parameter_code: 'b', finding: { kind: 'skipped_output', tool: 'x', cause: 'error', reason: 'script error: boom' } },
		]);
		expect(chips.map((c) => c.label).sort()).toEqual(["x can't compute: inputs missing (1)", 'x failed: boom (1)']);
	});

	it("falls back to the cell's writer, then its own code, for the calculation", () => {
		const chips = calculationFindings([
			cell('x', 'stale_output', undefined, 'DIC'),
			cell('y', 'stale_output'),
		]);
		expect(chips.map((c) => c.calculation)).toEqual(['DIC', 'y']);
	});

	it('leaves out findings no calculation raised', () => {
		expect(calculationFindings([cell('a', 'replicate_stats', 'x')])).toEqual([]);
	});
});

describe('recomputeFixable', () => {
	it('counts the stale and missing outputs, in either cell shape', () => {
		expect(
			recomputeFixable([
				{ finding: { kind: 'stale_output' } },
				{ finding: { kind: 'missing_output' } },
				{ finding: { kind: 'skipped_output' } },
			]),
		).toBe(2);
		expect(
			recomputeFixable([
				{ finding: 'stale_output', finding_count: 3 },
				{ finding: 'skipped_output', finding_count: 2 },
			]),
		).toBe(3);
		// A count is served only past one, so a finding with none is still one.
		expect(recomputeFixable([{ finding: 'missing_output', finding_count: 0 }])).toBe(1);
	});
});

describe('visitCalculationBadge', () => {
	it('says what a recompute would fix, and nothing for skips alone', () => {
		expect(visitCalculationBadge('stale', 2)?.label).toBe('Recompute would fix 2');
		expect(visitCalculationBadge('stale', 0)).toBeNull();
		expect(visitCalculationBadge('current', 0)).toBeNull();
	});

	it('keeps a job in flight or failed ahead of the findings', () => {
		expect(visitCalculationBadge('running', 2)).toEqual(RECOMPUTE_BADGE.running);
		expect(visitCalculationBadge('failed', 1)).toEqual(RECOMPUTE_BADGE.failed);
	});
});

describe('inputsWithoutValue', () => {
	it("names the calculation's inputs that hold no value at the visit", () => {
		const columns = [
			{ parameterId: 'alk', code: 'alk', readBy: ['pco2real'] },
			{ parameterId: 'ph', code: 'ph', readBy: ['pco2real', 'DIC'] },
			{ parameterId: 'temp', code: 'temp', readBy: ['DIC'] },
		];
		const cells = [
			{ parameter_id: 'ph', served_value: 7.9 },
			{ parameter_id: 'alk', served_value: undefined },
		];
		expect(inputsWithoutValue(columns, cells, 'pco2real')).toEqual(['alk']);
		expect(inputsWithoutValue(columns, cells, 'DIC')).toEqual(['temp']);
	});
});
