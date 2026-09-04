import { goto } from '$app/navigation';
import { page } from '$app/state';
import { untrack } from 'svelte';

/**
 * Mirror a chart layout onto one query param so the URL is shareable. Reads the param once
 * during init; writes back debounced (a slider drag changes the layout many times a second) via
 * replaceState, copying the current URL so `?tab` and the other tab's layout survive.
 */
export function syncUrlSpecs<T>(opts: {
	param: string;
	get: () => T[];
	encode: (specs: T[]) => string;
	delay?: number;
}): void {
	const { param, get, encode, delay = 300 } = opts;
	let timer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const encoded = encode(get());
		untrack(() => {
			clearTimeout(timer);
			timer = setTimeout(() => {
				const url = new URL(page.url);
				if ((url.searchParams.get(param) ?? '') === encoded) return;
				if (encoded) url.searchParams.set(param, encoded);
				else url.searchParams.delete(param);
				goto(url, { replaceState: true, noScroll: true, keepFocus: true });
			}, delay);
		});
		return () => clearTimeout(timer);
	});
}
