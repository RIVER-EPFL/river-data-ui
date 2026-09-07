import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$auth/keycloak.svelte', () => ({
	auth: { token: 'tok', ensureToken: async () => {} },
}));

const { jobWaitLabel, pollJob } = await import('./service');

type Row = Record<string, unknown>;

/** Serves one row per poll, so a test can walk a job through its states. */
function serve(rows: Row[]) {
	let i = 0;
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => {
			const body = rows[Math.min(i++, rows.length - 1)];
			return {
				ok: true,
				status: 200,
				statusText: 'ok',
				headers: new Headers(),
				json: async () => body,
				text: async () => JSON.stringify(body),
			};
		}),
	);
}

const job = (over: Row = {}): Row => ({
	id: 'job',
	status: 'queued',
	retry_count: 0,
	error_message: null,
	progress: null,
	total: null,
	detail: {},
	...over,
});

beforeEach(() => vi.unstubAllGlobals());

describe('pollJob', () => {
	it('reports every row it reads, so a caller can render the wait', async () => {
		serve([job({ status: 'running', progress: 40, total: 100 }), job({ status: 'completed' })]);
		const seen: string[] = [];
		const final = await pollJob('job', { intervalMs: 0, onTick: (j) => seen.push(j.status) });
		expect(seen).toEqual(['running', 'completed']);
		expect(final.status).toBe('completed');
	});

	it('fails with the job’s own error rather than the poller’s timeout', async () => {
		serve([job({ status: 'failed', error_message: 'Plan is no longer in draft status' })]);
		await expect(pollJob('job', { intervalMs: 0 })).rejects.toThrow(
			'Plan is no longer in draft status',
		);
	});

	it('keeps waiting through a retry, and says which attempt it is on', async () => {
		serve([
			job({ status: 'queued', retry_count: 1, error_message: 'connection reset' }),
			job({ status: 'completed' }),
		]);
		const seen: string[] = [];
		const final = await pollJob('job', {
			intervalMs: 0,
			onTick: (j) => seen.push(jobWaitLabel(j)),
		});
		expect(seen[0]).toBe('Retrying after connection reset (attempt 2)');
		expect(final.status).toBe('completed');
	});

	it('times out only while the job is still moving', async () => {
		serve([job({ status: 'running' })]);
		await expect(pollJob('job', { intervalMs: 0, timeoutMs: -1 })).rejects.toThrow(
			'Timed out waiting for job',
		);
	});
});
