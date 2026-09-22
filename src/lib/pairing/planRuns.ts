/**
 * The apply and revert the operator started in this tab. Both run as jobs and hand the operator
 * back, so the plan's row says which one is running until its job reports a terminal status.
 */
export interface PlanRuns {
	applyJobId: string;
	applyingPlanId: string;
	revertJobId: string;
	revertingPlanId: string;
}

export const NO_PLAN_RUNS: PlanRuns = {
	applyJobId: '',
	applyingPlanId: '',
	revertJobId: '',
	revertingPlanId: '',
};

/** The runs still going once `jobId` has finished. A job this tab did not start changes nothing. */
export function runsAfterJob(runs: PlanRuns, jobId: string): PlanRuns {
	if (jobId && jobId === runs.applyJobId) {
		return { ...runs, applyJobId: '', applyingPlanId: '' };
	}
	if (jobId && jobId === runs.revertJobId) {
		return { ...runs, revertJobId: '', revertingPlanId: '' };
	}
	return runs;
}

/** The progress the plan's job last reported, as the `job_progress` event carries it. */
export interface PlanRunProgress {
	status: string;
	progress: number | null;
	total: number | null;
}

const PLAN_RUN_WORDS = {
	apply: { waiting: 'Applying…', step: 'Pairing' },
	revert: { waiting: 'Reverting…', step: 'Unpairing' },
} as const;

/**
 * What a plan's row says while its job runs: the phase it is in, rather than a word that stands
 * unchanged from the enqueue to the last slot. A run that has reported nothing yet reads as the
 * verb alone.
 */
export function planRunLabel(
	run: keyof typeof PLAN_RUN_WORDS,
	progress: PlanRunProgress | null,
): string {
	const words = PLAN_RUN_WORDS[run];
	if (!progress) return words.waiting;
	if (progress.status === 'queued' || progress.status === 'pending' || progress.status === 'retrying')
		return 'Queued…';
	if (progress.total != null && progress.progress != null)
		return `${words.step} ${progress.progress}/${progress.total}`;
	return words.waiting;
}
