// Where a job that has not started yet stands in the pool's queue. `claim_one` selects the due
// rows ordered by `next_attempt_at` and takes the first, so a row's position is the waiting rows
// that sort ahead of it; the queue is read from the server rather than from whatever page a panel
// happens to hold, because a burst of slot jobs runs to thousands of rows.

import { api } from '$api/crud';

/** A job the pool has not started: it sits in the queue rather than holding a worker. */
const WAITING_STATUSES = new Set(['queued', 'pending', 'retrying']);

export function isJobWaiting(status: string): boolean {
	return WAITING_STATUSES.has(status);
}

export interface WaitingJob {
	id: string;
	status: string;
	created_at: string;
	next_attempt_at?: string | null;
}

/** The queue as a row reads itself in it: how many wait ahead of each, over the rows read. */
export interface JobQueue {
	ahead: Map<string, number>;
	read: number;
}

export const EMPTY_JOB_QUEUE: JobQueue = { ahead: new Map(), read: 0 };

/** How many rows of the queue one read takes. Past it a row knows only that it is further back. */
export const QUEUE_READ_LIMIT = 200;

// `created_at` and the id break a tie, so two rows enqueued in the same instant read as distinct
// positions rather than both as next.
function claimsFirst(a: WaitingJob, b: WaitingJob): boolean {
	const due = (j: WaitingJob) => Date.parse(j.next_attempt_at ?? j.created_at);
	if (due(a) !== due(b)) return due(a) < due(b);
	if (a.created_at !== b.created_at) return a.created_at < b.created_at;
	return a.id < b.id;
}

export function jobQueue(waiting: WaitingJob[]): JobQueue {
	const ordered = [...waiting].filter((j) => isJobWaiting(j.status)).sort((a, b) => (claimsFirst(a, b) ? -1 : 1));
	return {
		ahead: new Map(ordered.map((job, index) => [job.id, index])),
		read: ordered.length,
	};
}

/** Read the head of the queue, in the order the pool claims it. */
export async function loadJobQueue(): Promise<JobQueue> {
	const result = await api.reprocessingJobs.list({
		perPage: QUEUE_READ_LIMIT,
		sort: ['next_attempt_at', 'ASC'],
		filter: { status: 'queued' },
	});
	return jobQueue(result.data);
}

/**
 * What a job row says about where it has got to: the counts it reports, its place in the queue
 * while it waits, and the status word only when it is neither.
 */
export function jobProgressLabel(
	job: WaitingJob & { progress?: number | null; total?: number | null },
	queue: JobQueue,
): string {
	if (job.total != null && job.progress != null) return `${job.progress}/${job.total}`;
	if (!isJobWaiting(job.status)) return job.status;
	const ahead = queue.ahead.get(job.id);
	if (ahead == null) return `${job.status}, over ${queue.read} ahead`;
	return ahead === 0 ? `${job.status}, next` : `${job.status}, ${ahead} ahead`;
}
