import { describe, expect, it } from 'vitest';
import type { ReplicateAuditHold } from '$api/service';
import {
	oursText,
	readTagParams,
	readingTagsHref,
	sourceText,
	tagBrowseHref,
	tagPointHref,
	tagQuery,
} from './discrepancies';
import { TAG_KINDS } from './holds';

function hold(extra: Partial<ReplicateAuditHold> = {}): ReplicateAuditHold {
	return {
		id: 'hold-1',
		stream_id: 'stream-1',
		kind: 'replicate_stats',
		source_system: 'cnet',
		source_key: 'FP3:DOC_avg_ppb:reps',
		source_name: null,
		site_id: 'site-1',
		site_parameter_id: 'sp-1',
		site_name: 'FP3',
		parameter_name: 'DOC',
		parameter_code: 'DOC',
		tool: null,
		paired: true,
		group_time: '2021-07-14T09:00:00Z',
		expected: { mean: 20, sd: 8.16, n: 4 },
		computed: { mean: 20.5, sd: 10, n: 3 },
		delta: { mean: -0.5, sd: -1.84 },
		status: 'deferred',
		classification: 'unexplained',
		resolution: null,
		created_at: '2021-07-15T00:00:00Z',
		acknowledged_by: null,
		acknowledged_at: null,
		relative_delta: 0.2,
		mean_relative_delta: 0.02,
		sd_relative_delta: 0.2,
		...extra,
	} as ReplicateAuditHold;
}

describe('tagQuery', () => {
	it('asks for every tag kind under every status when nothing is filtered', () => {
		expect(tagQuery({}, 1, 50)).toEqual({
			page: 1,
			page_size: 50,
			status: 'any',
			kind: 'replicate_stats,curve_claim_stripped',
		});
	});

	it('carries each filter the browse offers', () => {
		const q = tagQuery(
			{
				kind: 'curve_claim_stripped',
				siteId: 's',
				parameterId: 'p',
				from: '2021-01-01T00:00:00.000Z',
				to: '2022-01-01T00:00:00.000Z',
			},
			2,
			100,
		);
		expect(q).toMatchObject({
			page: 2,
			kind: 'curve_claim_stripped',
			site_id: 's',
			parameter_id: 'p',
			from: '2021-01-01T00:00:00.000Z',
			to: '2022-01-01T00:00:00.000Z',
		});
	});

	it('never widens to a kind a person still acts on', () => {
		expect(tagQuery({ kind: 'brake_fired' }, 1, 50).kind).toBe(TAG_KINDS.join(','));
	});
});

describe('the browse link', () => {
	it('reads back the filter it wrote', () => {
		const filter = { kind: 'replicate_stats' as const, siteId: 's', parameterId: 'p', from: 'a', to: 'b' };
		const href = tagBrowseHref(filter);
		expect(href).toContain('tab=review&review=discrepancies');
		expect(readTagParams(new URL(href, 'http://x').searchParams)).toEqual(filter);
	});

	it('narrows to the one instant a reading sits at', () => {
		const href = readingTagsHref('s', 'p', '2021-07-14T09:00:00Z');
		const filter = readTagParams(new URL(href, 'http://x').searchParams);
		expect(filter.from).toBe('2021-07-14T09:00:00.000Z');
		expect(filter.to).toBe('2021-07-14T09:00:00.001Z');
	});
});

describe('a tag row', () => {
	it('opens the point record of its reading', () => {
		expect(tagPointHref(hold())).toBe('/admin/sites/site-1?point=sp-1&t=2021-07-14T09%3A00%3A00.000Z&mt=spot');
	});

	it('has no point record while its stream is unpaired', () => {
		expect(tagPointHref(hold({ site_id: null, site_parameter_id: null }))).toBeNull();
	});

	it("sets the source's statistics beside ours", () => {
		expect(sourceText(hold())).toBe('mean 20, sd 8.16, n 4');
		expect(oursText(hold())).toBe('mean 20.5, sd 10, n 3');
	});

	it('counts a stripped curve claim on each side', () => {
		const stripped = hold({
			kind: 'curve_claim_stripped',
			expected: { claims: [{}, {}] } as unknown as ReplicateAuditHold['expected'],
			computed: { stored_without_curve: 2 } as unknown as ReplicateAuditHold['computed'],
		});
		expect(sourceText(stripped)).toBe('2 curve claims');
		expect(oursText(stripped)).toBe('2 stored without a curve');
	});
});
