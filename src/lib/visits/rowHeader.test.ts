import { describe, expect, it } from 'vitest';

import { SYNCED_VISIT_NOTICE } from './recompute';
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
		expect(visitRowHeader(visit(), false)).toEqual({ classNames: [], title: null, opensFindings: false });
	});

	it('is shaded with the count and kinds where findings are open, and opens them', () => {
		const header = visitRowHeader(
			visit({ findings_open: 2, cells: [{ finding: 'stale_output' }, { finding: 'replicate_stats' }] }),
			false,
		);
		expect(header.classNames).toEqual(['sheet-finding']);
		expect(header.title).toMatch(/^2 findings: stale output, replicate stats\./);
		expect(header.opensFindings).toBe(true);
	});

	it('carries the synced notice on a mixed site, and leaves it to the notice above an all-synced one', () => {
		expect(visitRowHeader(visit({ source: 'portal_sync' }), false).title).toContain(SYNCED_VISIT_NOTICE);
		expect(visitRowHeader(visit({ source: 'portal_sync' }), true).title).toBeNull();
	});

	it('marks a pending field day and strikes a rejected one', () => {
		const pending = visitRowHeader(visit({ unverified: true }), false);
		expect(pending.classNames).toEqual(['sheet-pending']);
		expect(pending.title).toBe(UNVERIFIED_VISIT_NOTICE);
		expect(visitRowHeader(visit({ withdrawn_at: '2026-09-01T00:00:00Z' }), false).classNames).toEqual([
			'sheet-struck',
		]);
	});
});
