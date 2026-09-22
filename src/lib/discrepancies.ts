// Discrepancy tags: what an import recorded about data that disagrees with its source. Read, never
// worked; the kinds a person still acts on stay in the audits queue.

import { base } from '$app/paths';
import type { HoldKind, ReplicateAuditHold } from '$api/service';
import { TAG_KINDS } from '$lib/holds';

export interface TagFilter {
	kind?: HoldKind;
	siteId?: string;
	parameterId?: string;
	/** Inclusive start, an ISO instant. */
	from?: string;
	/** Exclusive end, an ISO instant. */
	to?: string;
	streamIds?: string[];
	classification?: 'source_sd_matches_n_divisor' | 'not_source_sd_matches_n_divisor';
}

const PARAM = {
	kind: 'tags_kind',
	siteId: 'tags_site',
	parameterId: 'tags_parameter',
	from: 'tags_from',
	to: 'tags_to',
} as const;

/** The list route's query for one page of tags under a filter, across every status. */
export function tagQuery(filter: TagFilter, page: number, pageSize: number) {
	return {
		page,
		page_size: pageSize,
		status: 'any',
		kind: filter.kind && TAG_KINDS.includes(filter.kind) ? filter.kind : TAG_KINDS.join(','),
		...(filter.siteId ? { site_id: filter.siteId } : {}),
		...(filter.parameterId ? { parameter_id: filter.parameterId } : {}),
		...(filter.from ? { from: filter.from } : {}),
		...(filter.to ? { to: filter.to } : {}),
		...(filter.streamIds?.length ? { stream_ids: filter.streamIds.join(',') } : {}),
		...(filter.classification ? { classification: filter.classification } : {}),
	};
}

export function readTagParams(params: URLSearchParams): TagFilter {
	const kind = params.get(PARAM.kind);
	const filter: TagFilter = {};
	if (kind && (TAG_KINDS as string[]).includes(kind)) filter.kind = kind as HoldKind;
	for (const key of ['siteId', 'parameterId', 'from', 'to'] as const) {
		const value = params.get(PARAM[key]);
		if (value) filter[key] = value;
	}
	return filter;
}

/** The streams page's informational review section under a filter. */
export function tagBrowseHref(filter: TagFilter): string {
	const params = new URLSearchParams({ tab: 'review', review: 'discrepancies' });
	if (filter.kind) params.set(PARAM.kind, filter.kind);
	for (const key of ['siteId', 'parameterId', 'from', 'to'] as const) {
		const value = filter[key];
		if (value) params.set(PARAM[key], value);
	}
	return `${base}/streams?${params}`;
}

/** The browse narrowed to one instant of one slot: every tag recorded against that reading. */
export function readingTagsHref(
	siteId: string,
	parameterId: string,
	timeIso: string,
	kind?: HoldKind,
): string {
	const at = new Date(timeIso).getTime();
	return tagBrowseHref({
		kind,
		siteId,
		parameterId,
		from: new Date(at).toISOString(),
		to: new Date(at + 1).toISOString(),
	});
}

/** The point record of the reading a tag is on; null when its stream is not paired. */
export function tagPointHref(hold: ReplicateAuditHold): string | null {
	if (!hold.site_id || !hold.site_parameter_id) return null;
	const params = new URLSearchParams({
		point: hold.site_parameter_id,
		t: new Date(hold.group_time).toISOString(),
		mt: 'spot',
	});
	return `${base}/sites/${hold.site_id}?${params}`;
}

function stat(v: number | null | undefined): string {
	return v == null ? '-' : String(Number(v.toFixed(4)));
}

/** What the source said, in one line. */
export function sourceText(hold: ReplicateAuditHold): string {
	if (hold.kind === 'curve_claim_stripped') {
		const claims = (hold.expected as { claims?: unknown[] }).claims ?? [];
		return `${claims.length} curve claim${claims.length === 1 ? '' : 's'}`;
	}
	const e = hold.expected;
	return `mean ${stat(e.mean)}, sd ${stat(e.sd)}, n ${e.n ?? '-'}`;
}

/** What river-data stored instead, in one line. */
export function oursText(hold: ReplicateAuditHold): string {
	if (hold.kind === 'curve_claim_stripped') {
		const n = (hold.computed as { stored_without_curve?: number }).stored_without_curve ?? 0;
		return `${n} stored without a curve`;
	}
	const c = hold.computed;
	return `mean ${stat(c.mean)}, sd ${stat(c.sd)}, n ${c.n ?? '-'}`;
}
