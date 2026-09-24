import { describe, expect, it } from 'vitest';
import {
	RECOMPUTE_BADGE,
	changedPayload,
	computing,
	movedOutputs,
	runOutputs,
	readUntilSettled,
	runReportLine,
	visitBadge,
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
