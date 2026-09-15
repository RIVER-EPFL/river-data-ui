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
