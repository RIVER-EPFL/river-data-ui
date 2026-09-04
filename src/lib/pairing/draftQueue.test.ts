import { describe, expect, it, vi } from 'vitest';

import { createDraftQueue } from './draftQueue';

class HttpError extends Error {
	constructor(public status: number) {
		super(`HTTP ${status}`);
	}
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('pairing draft queue', () => {
	it('sends an action change without waiting for the debounce', async () => {
		const sent: unknown[][] = [];
		const queue = createDraftQueue<{ stream_id: string }>({
			send: async (batch) => { sent.push(batch); },
			debounceMs: 10_000,
		});

		queue.enqueue([{ stream_id: 'a' }], { immediate: true });
		await tick();

		expect(sent).toEqual([[{ stream_id: 'a' }]]);
		expect(queue.pending()).toBe(0);
	});

	it('retries a 503 on its own, without a further edit', async () => {
		vi.useFakeTimers();
		try {
			const send = vi
				.fn()
				.mockRejectedValueOnce(new HttpError(503))
				.mockResolvedValueOnce(undefined);
			const scheduled: number[] = [];
			const queue = createDraftQueue<{ stream_id: string }>({
				send,
				retryMs: 100,
				onRetryScheduled: (_attempt, delay) => scheduled.push(delay),
			});

			queue.enqueue([{ stream_id: 'a' }], { immediate: true });
			await vi.advanceTimersByTimeAsync(0);
			expect(send).toHaveBeenCalledTimes(1);
			// The failed batch is kept, and reported as unsaved.
			expect(queue.pending()).toBe(1);
			expect(scheduled).toEqual([100]);

			await vi.advanceTimersByTimeAsync(100);
			expect(send).toHaveBeenCalledTimes(2);
			expect(queue.pending()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it('backs off on each further failure rather than hammering', async () => {
		vi.useFakeTimers();
		try {
			const send = vi.fn().mockRejectedValue(new HttpError(500));
			const scheduled: number[] = [];
			const queue = createDraftQueue<{ stream_id: string }>({
				send,
				retryMs: 100,
				maxRetries: 3,
				onRetryScheduled: (_a, delay) => scheduled.push(delay),
			});

			queue.enqueue([{ stream_id: 'a' }], { immediate: true });
			await vi.advanceTimersByTimeAsync(0);
			await vi.advanceTimersByTimeAsync(100);
			await vi.advanceTimersByTimeAsync(200);
			await vi.advanceTimersByTimeAsync(400);

			expect(scheduled).toEqual([100, 200, 400]);
			expect(send).toHaveBeenCalledTimes(4);
			// The decision is still reported as unsaved.
			expect(queue.pending()).toBe(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it('drops a batch the server refused instead of retrying it forever', async () => {
		const send = vi.fn().mockRejectedValue(new HttpError(400));
		const refused: unknown[] = [];
		const queue = createDraftQueue<{ stream_id: string }>({
			send,
			onRefused: (e) => refused.push(e),
		});

		queue.enqueue([{ stream_id: 'a' }], { immediate: true });
		await tick();

		expect(send).toHaveBeenCalledTimes(1);
		expect(refused).toHaveLength(1);
		expect(queue.pending()).toBe(0);
	});

	it('debounces text edits into one batch and reports what is unsaved', async () => {
		vi.useFakeTimers();
		try {
			const send = vi.fn().mockResolvedValue(undefined);
			const seen: number[] = [];
			const queue = createDraftQueue<{ stream_id: string }>({
				send,
				debounceMs: 300,
				onPendingChange: (n) => seen.push(n),
			});

			queue.enqueue([{ stream_id: 'a' }]);
			queue.enqueue([{ stream_id: 'b' }]);
			await vi.advanceTimersByTimeAsync(299);
			expect(send).not.toHaveBeenCalled();
			expect(queue.pending()).toBe(2);

			await vi.advanceTimersByTimeAsync(1);
			expect(send).toHaveBeenCalledTimes(1);
			expect(send.mock.calls[0][0]).toEqual([{ stream_id: 'a' }, { stream_id: 'b' }]);
			expect(seen.at(-1)).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it('flush sends immediately and resolves only when the queue is empty', async () => {
		const send = vi.fn().mockResolvedValue(undefined);
		const queue = createDraftQueue<{ stream_id: string }>({ send, debounceMs: 10_000 });

		queue.enqueue([{ stream_id: 'a' }]);
		await queue.flush();

		expect(send).toHaveBeenCalledTimes(1);
		expect(queue.pending()).toBe(0);
	});
});
