import { describe, expect, it } from 'vitest';

import { RECOMPUTE_BADGE } from './recompute';
import { UNVERIFIED_VISIT_NOTICE } from './verification';
import { cellFinding, visitRowHeader } from './rowHeader';

const visit = (over = {}) => ({
	findings_open: 0,
	cells: [],
	source: 'manual',
	recompute: 'current',
	unverified: false,
	withdrawn_at: undefined,
	...over,
});

describe('a cell carrying a hold', () => {
	it('is shaded whatever the kind, and says what the kind means', () => {
		for (const kind of ['stale_output', 'replicate_stats', 'source_modified', 'unverified_entry']) {
			expect(cellFinding({ finding: kind })?.className).toBe('sheet-finding');
		}
		expect(cellFinding({ finding: 'source_modified' })?.title).toMatch(/^The source changed this value/);
	});

	it('names a kind it has no sentence for, and counts a second finding', () => {
		expect(cellFinding({ finding: 'new_kind' })?.title).toMatch(/^new kind\./);
		expect(cellFinding({ finding: 'stale_output', finding_count: 2 })?.title).toContain('2 findings');
	});

	it('is left alone without one', () => {
		expect(cellFinding({ finding: undefined })).toBeNull();
		expect(cellFinding(null)).toBeNull();
	});
});

describe('the row index of a visit', () => {
	it('is plain on a settled visit with nothing open', () => {
		expect(visitRowHeader(visit())).toEqual({ classNames: [], title: null, opensFindings: false });
	});

	it('is shaded with the count and kinds where findings are open, and opens them', () => {
		const header = visitRowHeader(
			visit({ findings_open: 2, cells: [{ finding: 'stale_output' }, { finding: 'replicate_stats' }] }),
		);
		expect(header.classNames).toEqual(['sheet-finding']);
		expect(header.title).toMatch(/^2 findings: stale output, replicate stats\./);
		expect(header.opensFindings).toBe(true);
	});

	it("reads a synced visit's calculation state as it reads any other", () => {
		expect(visitRowHeader(visit({ source: 'portal_sync' })).title).toBeNull();
		const stale = visit({ source: 'portal_sync', recompute: 'stale', findings_open: 1, cells: [{ finding: 'stale_output' }] });
		expect(visitRowHeader(stale).title).toContain('Calculations: Recompute would fix 1.');
		expect(visitRowHeader(visit({ recompute: 'failed' })).title).toContain(RECOMPUTE_BADGE.failed.label);
	});

	it('says nothing of a recompute at a visit whose only findings are skips', () => {
		const skipped = visit({ recompute: 'stale', findings_open: 2, cells: [{ finding: 'skipped_output', finding_count: 2 }] });
		expect(visitRowHeader(skipped).title).not.toContain('Calculations:');
	});

	it('marks a pending field day and strikes a rejected one', () => {
		const pending = visitRowHeader(visit({ unverified: true }));
		expect(pending.classNames).toEqual(['sheet-pending']);
		expect(pending.title).toBe(UNVERIFIED_VISIT_NOTICE);
		expect(visitRowHeader(visit({ withdrawn_at: '2026-09-01T00:00:00Z' })).classNames).toEqual([
			'sheet-struck',
		]);
	});
});
