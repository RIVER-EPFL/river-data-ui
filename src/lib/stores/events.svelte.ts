import { fetchEventSource, EventStreamContentType } from '@microsoft/fetch-event-source';
import { auth } from '$auth/keycloak.svelte';

// SSE event types from the API
export interface JobCreatedEvent {
	type: 'job_created';
	job_id: string;
}
export interface JobProgressEvent {
	type: 'job_progress';
	job_id: string;
	status: string;
	progress: number | null;
	total: number | null;
}
export interface JobCompletedEvent {
	type: 'job_completed';
	job_id: string;
	status: string;
	readings_updated: number | null;
	error_message: string | null;
}
export interface DataIngestedEvent {
	type: 'data_ingested';
	site_id: string | null;
	parameter_id: string | null;
	stream_id: string;
	count: number;
}
export type AppEvent = JobCreatedEvent | JobProgressEvent | JobCompletedEvent | DataIngestedEvent;

type Callback = (event: AppEvent) => void;

let connected = $state(false);
let subscribers = new Map<string, Set<Callback>>();
let abortController: AbortController | null = null;
let retryDelay = 1000;
const MAX_RETRY_DELAY = 30_000;

function totalSubscribers(): number {
	let count = 0;
	for (const set of subscribers.values()) {
		count += set.size;
	}
	return count;
}

function connect() {
	if (abortController) return;

	abortController = new AbortController();
	retryDelay = 1000;

	startStream();
}

async function startStream() {
	if (!abortController) return;

	try {
		await auth.ensureToken();
	} catch {
		scheduleRetry();
		return;
	}

	const headers: Record<string, string> = {};
	if (auth.token) {
		headers['Authorization'] = `Bearer ${auth.token}`;
	}

	fetchEventSource('/api/events', {
		signal: abortController!.signal,
		headers,

		onopen(response) {
			if (response.ok && response.headers.get('content-type')?.includes(EventStreamContentType)) {
				connected = true;
				retryDelay = 1000;
				return Promise.resolve();
			}
			// Non-retriable error — will fall through to onerror
			throw new Error(`SSE open failed: ${response.status} ${response.statusText}`);
		},

		onmessage(msg) {
			if (!msg.data) return;

			let event: AppEvent;
			try {
				event = JSON.parse(msg.data);
			} catch {
				return;
			}

			const callbacks = subscribers.get(event.type);
			if (callbacks) {
				for (const cb of callbacks) {
					cb(event);
				}
			}
		},

		onclose() {
			connected = false;
			if (totalSubscribers() > 0) {
				scheduleRetry();
			}
		},

		onerror() {
			connected = false;
			// Return the retry interval; fetchEventSource will reconnect after this delay.
			// If no subscribers remain, abort instead.
			if (totalSubscribers() === 0) {
				disconnect();
				throw new Error('no subscribers');
			}
			const delay = retryDelay;
			retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY);
			return delay;
		},

		openWhenHidden: true,
	});
}

function scheduleRetry() {
	if (totalSubscribers() === 0) {
		disconnect();
		return;
	}

	const delay = retryDelay;
	retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY);

	setTimeout(() => {
		if (totalSubscribers() > 0 && !abortController) {
			connect();
		}
	}, delay);
}

function disconnect() {
	if (abortController) {
		abortController.abort();
		abortController = null;
	}
	connected = false;
}

function subscribe(eventType: string, callback: (event: AppEvent) => void): () => void {
	let set = subscribers.get(eventType);
	if (!set) {
		set = new Set();
		subscribers.set(eventType, set);
	}
	set.add(callback);

	// First subscriber triggers connection
	if (totalSubscribers() === 1) {
		connect();
	}

	return () => {
		const s = subscribers.get(eventType);
		if (s) {
			s.delete(callback);
			if (s.size === 0) {
				subscribers.delete(eventType);
			}
		}
		// Last subscriber triggers disconnect
		if (totalSubscribers() === 0) {
			disconnect();
		}
	};
}

export const eventBus = {
	get connected() {
		return connected;
	},
	subscribe,
};
