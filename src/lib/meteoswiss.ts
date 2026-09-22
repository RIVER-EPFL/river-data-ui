// What a site's MeteoSwiss subscription is actually doing, read from the stream it feeds and the
// backfill that read its history. A subscription that lands nothing looks exactly like one that
// works until these two are put beside it.

import type { DataStream, ReprocessingJob } from '$api/crud';

/** The stream `provision` registers for a subscription, by the key it builds. */
export function streamKey(station: string, variable: string, siteId: string): string {
	return `${station.trim().toUpperCase()}:${variable.trim().toLowerCase()}:${siteId}`;
}

export type FeedStatus =
	| { kind: 'flowing'; at: string }
	| { kind: 'failed'; message: string }
	| { kind: 'working' }
	| { kind: 'empty' };

/**
 * A subscription's state: a value landed beats anything a job says, because the feed is working;
 * otherwise the backfill's own outcome is what there is to report.
 */
export function feedStatus(stream: DataStream | null, job: ReprocessingJob | null): FeedStatus {
	if (stream?.last_data_time) return { kind: 'flowing', at: stream.last_data_time };
	if (job?.status === 'failed') {
		return { kind: 'failed', message: job.error_message ?? 'the backfill failed' };
	}
	if (job && job.status !== 'completed') return { kind: 'working' };
	return { kind: 'empty' };
}

/** The most recent backfill of one station and variable, whichever site queued it. */
export function latestBackfill(
	jobs: ReprocessingJob[],
	station: string,
	variable: string
): ReprocessingJob | null {
	const wanted = (job: ReprocessingJob) =>
		String(job.params?.station ?? '').toUpperCase() === station.trim().toUpperCase() &&
		String(job.params?.variable ?? '').toLowerCase() === variable.trim().toLowerCase();
	const matching = jobs.filter((job) => job.trigger_type === 'meteoswiss_backfill' && wanted(job));
	matching.sort((a, b) => b.created_at.localeCompare(a.created_at));
	return matching[0] ?? null;
}
