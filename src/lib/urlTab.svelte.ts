import { goto } from '$app/navigation';
import { page } from '$app/state';
import { untrack } from 'svelte';

export interface UrlTabOptions {
	/** Canonical tab keys, in the same order as the labels passed to <Tabs>. */
	keys: string[];
	/** Legacy or alternate param values folded onto canonical keys (e.g. { '2': 'thresholds' }). */
	aliases?: Record<string, string>;
	/** Query param name (default 'tab'). */
	param?: string;
	/** Key to open when the param is absent (default keys[0]). */
	initial?: string;
}

export interface UrlTab {
	/** Active tab as an index, for <Tabs bind:active={tab.index}>. */
	index: number;
	/** Active tab as its canonical key, for {#if tab.key === '…'} dispatch. */
	key: string;
	/** Switch tab and mutate other query params in one navigation (no writeback race). */
	go(key: string, mutate?: (url: URL) => void): void;
}

/**
 * URL-synced tab state. Call during component init (registers an $effect).
 *
 * Resolves the initial tab from `?tab` (with aliases) synchronously, then reflects tab switches
 * back to the URL via replaceState so refresh / back / shared links restore the tab. The
 * writeback copies the full current URL, so unrelated params (`?show=`, `?site_id=`) survive.
 */
export function createUrlTab(opts: UrlTabOptions): UrlTab {
	const { keys, aliases = {}, param = 'tab' } = opts;

	function indexOf(raw: string | null): number {
		if (raw === null && opts.initial) raw = opts.initial;
		const key = raw ? (aliases[raw] ?? raw) : '';
		const i = keys.indexOf(key);
		return i >= 0 ? i : 0;
	}

	let idx = $state(indexOf(page.url.searchParams.get(param)));

	// go() performs its own navigation carrying extra params; the writeback effect must skip that
	// change or it would re-goto from the not-yet-updated page.url and drop the extra params.
	let pending: string | null = null;

	$effect(() => {
		const key = keys[idx] ?? keys[0];
		untrack(() => {
			if (pending === key) {
				pending = null;
				return;
			}
			const url = new URL(page.url);
			if (url.searchParams.get(param) !== key) {
				url.searchParams.set(param, key);
				goto(url, { replaceState: true, noScroll: true });
			}
		});
	});

	return {
		get index() {
			return idx;
		},
		set index(i: number) {
			if (i >= 0 && i < keys.length) idx = i;
		},
		get key() {
			return keys[idx] ?? keys[0];
		},
		set key(k: string) {
			const i = keys.indexOf(aliases[k] ?? k);
			if (i >= 0) idx = i;
		},
		go(k: string, mutate?: (url: URL) => void) {
			const i = keys.indexOf(aliases[k] ?? k);
			const key = keys[i >= 0 ? i : idx] ?? keys[0];
			pending = key;
			if (i >= 0) idx = i;
			const url = new URL(page.url);
			url.searchParams.set(param, key);
			mutate?.(url);
			goto(url, { replaceState: true, noScroll: true });
		},
	};
}
