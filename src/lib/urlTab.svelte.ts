import { goto } from '$app/navigation';
import { page } from '$app/state';
import { untrack } from 'svelte';

export interface UrlTabOptions {
	/**
	 * Canonical tab keys, in the same order as the labels passed to <Tabs>. A getter is read
	 * reactively, for a page whose tabs depend on loaded data (a role-gated tab).
	 */
	keys: string[] | (() => string[]);
	/** Legacy or alternate param values folded onto canonical keys (e.g. { '2': 'thresholds' }). */
	aliases?: Record<string, string>;
	/** Query param name (default 'tab'). */
	param?: string;
	/** Key to open when the param is absent (default keys[0]). */
	initial?: string;
	/**
	 * Write the default tab as an absent param, so a bare URL means the reader has not chosen one.
	 * An explicit param naming it is left as it is.
	 */
	omitDefault?: boolean;
}

export interface UrlTab {
	/** Active tab as an index, for <Tabs bind:active={tab.index}>. */
	index: number;
	/** Active tab as its canonical key, for {#if tab.key === '…'} dispatch. */
	key: string;
	/**
	 * Switch tab and mutate other query params in one navigation (no writeback race).
	 * `push` writes a history entry instead of replacing the current one, for a jump that
	 * leaves a surface the operator will want the back button to return to.
	 */
	go(key: string, mutate?: (url: URL) => void, opts?: { push?: boolean }): void;
}

/**
 * URL-synced tab state. Call during component init (registers an $effect).
 *
 * Resolves the initial tab from `?tab` (with aliases) synchronously, then reflects tab switches
 * back to the URL via replaceState so refresh / back / shared links restore the tab. The
 * writeback copies the full current URL, so unrelated params (`?show=`, `?site_id=`) survive.
 * A URL that changes under the component (back/forward over a pushed entry) moves the tab with
 * it, so the rendered tab and the address bar cannot disagree.
 *
 * The tab is held as a key, so a key list that changes keeps the open tab. A requested key the
 * list does not hold yet renders as the first tab and is not written back, so a deep link to a
 * tab that appears once data loads still lands on it.
 */
export function createUrlTab(opts: UrlTabOptions): UrlTab {
	const { aliases = {}, param = 'tab' } = opts;
	const keysOf = typeof opts.keys === 'function' ? opts.keys : () => opts.keys as string[];

	function defaultKey(): string {
		return opts.initial ?? keysOf()[0] ?? '';
	}

	function requestedBy(raw: string | null): string {
		return raw === null ? defaultKey() : (aliases[raw] ?? raw);
	}

	function stamp(url: URL, key: string) {
		if (opts.omitDefault && key === defaultKey()) url.searchParams.delete(param);
		else url.searchParams.set(param, key);
	}

	let requested = $state(requestedBy(page.url.searchParams.get(param)));
	const active = $derived.by(() => {
		const keys = keysOf();
		return keys.includes(requested) ? requested : (keys[0] ?? '');
	});

	// go() performs its own navigation carrying extra params; the writeback effect must skip that
	// change or it would re-goto from the not-yet-updated page.url and drop the extra params.
	let pending: string | null = null;

	$effect(() => {
		const key = requested;
		const held = !keysOf().includes(key);
		untrack(() => {
			if (pending === key) {
				pending = null;
				return;
			}
			const raw = page.url.searchParams.get(param);
			if (held || raw === key) return;
			const url = new URL(page.url);
			stamp(url, key);
			if (url.searchParams.get(param) !== raw) {
				goto(url, { replaceState: true, noScroll: true, keepFocus: true });
			}
		});
	});

	// Back/forward: the URL is the authority when it moves on its own. An absent param keeps the
	// open tab, and a bare URL navigated to under a chosen tab is stamped with it.
	$effect(() => {
		const raw = page.url.searchParams.get(param);
		untrack(() => {
			if (raw === null) {
				if (requested !== defaultKey() && keysOf().includes(requested)) {
					const url = new URL(page.url);
					stamp(url, requested);
					goto(url, { replaceState: true, noScroll: true, keepFocus: true });
				}
				return;
			}
			const key = requestedBy(raw);
			if (key !== requested) requested = key;
		});
	});

	return {
		get index() {
			return Math.max(keysOf().indexOf(active), 0);
		},
		set index(i: number) {
			const key = keysOf()[i];
			if (key !== undefined) requested = key;
		},
		get key() {
			return active;
		},
		set key(k: string) {
			const key = aliases[k] ?? k;
			if (keysOf().includes(key)) requested = key;
		},
		go(k: string, mutate?: (url: URL) => void, opts?: { push?: boolean }) {
			const key = keysOf().includes(aliases[k] ?? k) ? (aliases[k] ?? k) : active;
			if (key !== requested) {
				pending = key;
				requested = key;
			}
			const url = new URL(page.url);
			stamp(url, key);
			mutate?.(url);
			goto(url, {
				replaceState: !opts?.push,
				noScroll: !opts?.push,
				keepFocus: !opts?.push,
			});
		},
	};
}
