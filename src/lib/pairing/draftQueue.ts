/**
 * The review's unsaved decisions. A decision a person took must not live only in a component
 * variable: an action change is sent at once, a text edit debounces, a retriable failure is
 * retried with backoff, and what is still unsent is reportable so the header can say so.
 */
type TimerHandle = ReturnType<typeof setTimeout>;

export interface QueuedUpdate {
	stream_id: string;
	[key: string]: unknown;
}

export interface DraftQueueOptions<T> {
	/** Sends one batch. Rejecting with a 4xx status means refused; anything else is retriable. */
	send: (batch: T[]) => Promise<void>;
	/** Reads the HTTP status off a rejection, when it has one. */
	statusOf?: (error: unknown) => number | undefined;
	/** Debounce for text edits, milliseconds. */
	debounceMs?: number;
	/** First retry delay; each further attempt doubles it. */
	retryMs?: number;
	maxRetries?: number;
	onPendingChange?: (pending: number) => void;
	/** A batch reached the server. What was queued at that moment is now the draft's own. */
	onSaved?: () => void;
	onRefused?: (error: unknown) => void;
	onRetryScheduled?: (attempt: number, delayMs: number, error: unknown) => void;
	setTimeoutFn?: (fn: () => void, ms: number) => TimerHandle;
	clearTimeoutFn?: (handle: TimerHandle) => void;
}

export interface DraftQueue<T> {
	/** Queue updates. `immediate` sends without waiting for the debounce: a decision is one PATCH. */
	enqueue(updates: T[], opts?: { immediate?: boolean }): void;
	/** Send everything queued now; resolves when the queue is empty or rejects with the failure. */
	flush(): Promise<void>;
	/** How many updates are queued but unsent. */
	pending(): number;
}

const defaultStatusOf = (error: unknown): number | undefined => {
	const status = (error as { status?: unknown })?.status;
	return typeof status === 'number' ? status : undefined;
};

export function createDraftQueue<T>(options: DraftQueueOptions<T>): DraftQueue<T> {
	const {
		send,
		statusOf = defaultStatusOf,
		debounceMs = 300,
		retryMs = 1000,
		maxRetries = 5,
		onPendingChange,
		onSaved,
		onRefused,
		onRetryScheduled,
		setTimeoutFn = (fn, ms) => setTimeout(fn, ms),
		clearTimeoutFn = (handle) => clearTimeout(handle),
	} = options;

	let queued: T[] = [];
	let timer: TimerHandle | null = null;
	let chain: Promise<void> = Promise.resolve();
	let attempt = 0;

	const report = () => onPendingChange?.(queued.length);

	function arm(ms: number) {
		if (timer) clearTimeoutFn(timer);
		timer = setTimeoutFn(() => {
			timer = null;
			void flush().catch(() => {});
		}, ms);
	}

	async function sendBatch(): Promise<void> {
		if (queued.length === 0) return;
		const batch = queued;
		queued = [];
		report();
		try {
			await send(batch);
			attempt = 0;
			onSaved?.();
		} catch (error) {
			const status = statusOf(error);
			const refused = status !== undefined && status >= 400 && status < 500;
			if (refused) {
				// A refusal repeated is a refusal: re-queuing it would fail every later flush and
				// take the decisions made since down with it.
				onRefused?.(error);
				throw error;
			}
			queued = [...batch, ...queued];
			report();
			if (attempt < maxRetries) {
				const delay = retryMs * 2 ** attempt;
				attempt += 1;
				onRetryScheduled?.(attempt, delay, error);
				arm(delay);
			}
			throw error;
		}
	}

	function flush(): Promise<void> {
		if (timer) {
			clearTimeoutFn(timer);
			timer = null;
		}
		const pending = chain.then(sendBatch);
		// The stored chain absorbs the rejection so later flushes still run; callers still see it.
		chain = pending.catch(() => {});
		return pending;
	}

	return {
		enqueue(updates: T[], opts?: { immediate?: boolean }) {
			if (updates.length === 0) return;
			queued.push(...updates);
			report();
			if (opts?.immediate) void flush().catch(() => {});
			else arm(debounceMs);
		},
		flush,
		pending: () => queued.length,
	};
}
