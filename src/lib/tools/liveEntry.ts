/** How long typing pauses before a form previews its calculation. */
export const PREVIEW_DELAY_MS = 400;

/**
 * Runs `run` once typing has paused for `delay`, and reports only the latest call's answer: a
 * slower preview for older values never overwrites the one for what is on screen now.
 */
export function previewScheduler<T>(
	run: () => Promise<T>,
	apply: (value: T) => void,
	delay = PREVIEW_DELAY_MS,
) {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let generation = 0;
	function cancel() {
		if (timer) clearTimeout(timer);
		timer = null;
		generation++;
	}
	function schedule() {
		cancel();
		const mine = generation;
		timer = setTimeout(() => {
			timer = null;
			void run().then(
				(value) => {
					if (mine === generation) apply(value);
				},
				() => {},
			);
		}, delay);
	}
	return { schedule, cancel };
}

/** A form's values as a comparable snapshot, taken when it opens, resets or saves. */
export function entrySnapshot(form: unknown, curves: unknown): string {
	return JSON.stringify([form, curves]);
}

/** Whether the form holds typed values that were not saved: it moved since its last snapshot. */
export function hasUnsavedValues(snapshot: string | null, form: unknown, curves: unknown): boolean {
	return snapshot !== null && snapshot !== entrySnapshot(form, curves);
}
