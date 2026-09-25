import { describe, expect, it } from 'vitest';

import { jobProgressLabel, jobQueue, withJobProgress, type WaitingJob } from './jobQueue';

const waiting = (id: string, createdAt: string, nextAttemptAt?: string): WaitingJob => ({
	id,
	status: 'queued',
	created_at: createdAt,
	next_attempt_at: nextAttemptAt ?? createdAt,
});

describe('jobQueue', () => {
	it('counts the waiting jobs the pool claims first', () => {
		const rows = [
			waiting('c', '2026-09-22T09:00:02Z'),
			waiting('a', '2026-09-22T09:00:00Z'),
			waiting('b', '2026-09-22T09:00:01Z'),
		];
		const queue = jobQueue(rows);
		expect(queue.ahead.get('a')).toBe(0);
		expect(queue.ahead.get('b')).toBe(1);
		expect(queue.ahead.get('c')).toBe(2);
	});

	it('orders by next_attempt_at, not by creation, so a backed-off retry falls behind', () => {
		const backedOff = waiting('a', '2026-09-22T09:00:00Z', '2026-09-22T09:05:00Z');
		const fresh = waiting('b', '2026-09-22T09:00:01Z');
		const queue = jobQueue([backedOff, fresh]);
		expect(queue.ahead.get('a')).toBe(1);
		expect(queue.ahead.get('b')).toBe(0);
	});

	it('gives two rows queued at the same instant distinct positions', () => {
		const queue = jobQueue([waiting('a', '2026-09-22T09:00:00Z'), waiting('b', '2026-09-22T09:00:00Z')]);
		expect([queue.ahead.get('a'), queue.ahead.get('b')].sort()).toEqual([0, 1]);
	});

	it('leaves out a job that is running or finished', () => {
		const running = { ...waiting('r', '2026-09-22T08:59:00Z'), status: 'running' };
		const done = { ...waiting('d', '2026-09-22T08:58:00Z'), status: 'completed' };
		const queue = jobQueue([running, done, waiting('a', '2026-09-22T09:00:00Z')]);
		expect(queue.ahead.get('a')).toBe(0);
		expect(queue.ahead.has('r')).toBe(false);
		expect(queue.read).toBe(1);
	});
});

describe('jobProgressLabel', () => {
	const first = waiting('a', '2026-09-22T09:00:00Z');
	const second = waiting('b', '2026-09-22T09:00:01Z');
	const queue = jobQueue([first, second]);

	it('names the place in the queue rather than the status word', () => {
		expect(jobProgressLabel(first, queue)).toBe('queued, next');
		expect(jobProgressLabel(second, queue)).toBe('queued, 1 ahead');
	});

	it('keeps the reported counts for a run that has started', () => {
		const running = { ...first, status: 'running', progress: 120, total: 340 };
		expect(jobProgressLabel(running, queue)).toBe('120/340');
	});

	it('falls back to the status word for a job that neither waits nor counts', () => {
		expect(jobProgressLabel({ ...first, status: 'failed' }, queue)).toBe('failed');
	});

	it('says only that a job is further back than the queue that was read', () => {
		expect(jobProgressLabel(waiting('z', '2026-09-22T10:00:00Z'), queue)).toBe('queued, over 2 ahead');
	});
});

describe('withJobProgress', () => {
	const running = { id: 'j', status: 'running', progress: 0, total: 22 };

	it('keeps the total a count-only update leaves out', () => {
		expect(withJobProgress(running, { status: 'running', progress: 10, total: null })).toEqual({
			id: 'j',
			status: 'running',
			progress: 10,
			total: 22,
		});
	});

	it('keeps the committed count through a retry that announces none', () => {
		const at = withJobProgress(running, { status: 'running', progress: 10, total: null });
		expect(withJobProgress(at, { status: 'retrying', progress: null, total: null })).toMatchObject({
			status: 'retrying',
			progress: 10,
			total: 22,
		});
	});

	it('takes a new total when the update carries one', () => {
		expect(withJobProgress(running, { status: 'running', progress: 3, total: 40 })).toMatchObject({
			progress: 3,
			total: 40,
		});
	});
});
