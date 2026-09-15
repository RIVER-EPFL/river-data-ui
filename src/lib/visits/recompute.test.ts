import { describe, expect, it } from 'vitest';
import {
	RECOMPUTE_BADGE,
	SYNCED_VISIT_NOTICE,
	computedHere,
	computing,
	entryNoticeFor,
	movedOutputs,
	runOutputs,
	runReportLine,
	visitBadge,
	visitSourceLabel,
} from './recompute';

describe('visitBadge', () => {
	it('says a portal-synced visit is not calculated, whatever its recompute state', () => {
		for (const state of ['current', 'stale', 'queued', 'running', 'failed']) {
			expect(visitBadge('portal_sync', state)?.label).toBe('not calculated here');
		}
	});

	it('leaves a manual visit its own state', () => {
		expect(visitBadge('manual', 'stale')).toEqual(RECOMPUTE_BADGE.stale);
		expect(visitBadge('manual', 'current')).toBeNull();
		expect(visitBadge(undefined, undefined)).toBeNull();
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

describe('entryNoticeFor', () => {
	it('warns on a portal-synced visit and says nothing on one entered here', () => {
		expect(entryNoticeFor('portal_sync')).toBe(SYNCED_VISIT_NOTICE);
		expect(entryNoticeFor('manual')).toBeNull();
		expect(entryNoticeFor(undefined)).toBeNull();
	});
});

describe('computedHere', () => {
	it('is false for a portal-synced visit, whose outputs came with its values', () => {
		expect(computedHere('portal_sync')).toBe(false);
		expect(computedHere('manual')).toBe(true);
		expect(computedHere(undefined)).toBe(true);
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
