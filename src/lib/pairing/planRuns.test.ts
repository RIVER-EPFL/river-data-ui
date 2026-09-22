import { describe, expect, it } from 'vitest';

import { NO_PLAN_RUNS, planRunLabel, runsAfterJob, type PlanRuns } from './planRuns';

const running: PlanRuns = {
	applyJobId: 'job-a',
	applyingPlanId: 'plan-1',
	revertJobId: 'job-r',
	revertingPlanId: 'plan-2',
};

describe('runsAfterJob', () => {
	it('stops calling a plan applying once its job has finished', () => {
		const after = runsAfterJob(running, 'job-a');
		expect(after.applyJobId).toBe('');
		expect(after.applyingPlanId).toBe('');
		expect(after.revertingPlanId).toBe('plan-2');
	});

	it('stops calling a plan reverting once its job has finished', () => {
		const after = runsAfterJob(running, 'job-r');
		expect(after.revertJobId).toBe('');
		expect(after.revertingPlanId).toBe('');
		expect(after.applyingPlanId).toBe('plan-1');
	});

	it('leaves both alone for a job this tab did not start', () => {
		expect(runsAfterJob(running, 'job-elsewhere')).toBe(running);
	});

	it('does not match an empty job id against a tab with nothing running', () => {
		expect(runsAfterJob(NO_PLAN_RUNS, '')).toBe(NO_PLAN_RUNS);
	});
});

describe('planRunLabel', () => {
	it('says the plan is waiting, not that it is already pairing', () => {
		expect(planRunLabel('apply', { status: 'queued', progress: null, total: null })).toBe('Queued…');
	});

	it('names the pairing phase with its counts once the run has started', () => {
		expect(planRunLabel('apply', { status: 'running', progress: 120, total: 340 })).toBe('Pairing 120/340');
		expect(planRunLabel('revert', { status: 'running', progress: 12, total: 34 })).toBe('Unpairing 12/34');
	});

	it('falls back to the verb before any progress has been reported', () => {
		expect(planRunLabel('apply', null)).toBe('Applying…');
		expect(planRunLabel('revert', { status: 'running', progress: null, total: null })).toBe('Reverting…');
	});
});
