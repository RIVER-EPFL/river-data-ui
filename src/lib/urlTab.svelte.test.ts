import { flushSync } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => {
	const page = $state({
		url: new URL('http://localhost/admin/'),
		params: {} as Record<string, string>,
		route: { id: null as string | null },
	});
	return { page };
});

vi.mock('$app/navigation', async () => {
	const { page } = await import('$app/state');
	return {
		goto: vi.fn(async (url: URL) => {
			(page as { url: URL }).url = new URL(url);
		}),
	};
});

const { goto } = await import('$app/navigation');
const { page } = await import('$app/state');
const { createUrlTab } = await import('./urlTab.svelte');

const gotoMock = vi.mocked(goto);

function open(search: string) {
	(page as { url: URL }).url = new URL(`http://localhost/admin/sites/1${search}`);
}

function lastUrl(): URL {
	return gotoMock.mock.calls.at(-1)?.[0] as URL;
}

beforeEach(() => {
	gotoMock.mockClear();
});

describe('createUrlTab', () => {
	it('holds a requested key until the key list grows to include it', () => {
		open('?tab=status');
		let keys = $state(['charts', 'visits', 'notes']);
		let tab!: ReturnType<typeof createUrlTab>;
		const stop = $effect.root(() => {
			tab = createUrlTab({ keys: () => keys });
		});
		flushSync();
		expect(tab.key).toBe('charts');
		expect(gotoMock).not.toHaveBeenCalled();

		keys = ['charts', 'visits', 'status', 'notes'];
		flushSync();
		expect(tab.key).toBe('status');
		expect(tab.index).toBe(2);
		expect(gotoMock).not.toHaveBeenCalled();
		stop();
	});

	it('keeps the open tab by key when a key is inserted before it', () => {
		open('?tab=notes');
		let keys = $state(['charts', 'visits', 'notes']);
		let tab!: ReturnType<typeof createUrlTab>;
		const stop = $effect.root(() => {
			tab = createUrlTab({ keys: () => keys });
		});
		flushSync();
		expect(tab.index).toBe(2);

		keys = ['charts', 'visits', 'status', 'notes'];
		flushSync();
		expect(tab.key).toBe('notes');
		// Status now sits at 2, so notes moved to 3
		expect(tab.index).toBe(3);
		stop();
	});

	it('leaves the param off the URL for the default tab when asked', () => {
		open('?tab=visits');
		let tab!: ReturnType<typeof createUrlTab>;
		const stop = $effect.root(() => {
			tab = createUrlTab({ keys: ['charts', 'visits'], omitDefault: true });
		});
		flushSync();
		tab.index = 0;
		flushSync();
		expect(lastUrl().searchParams.has('tab')).toBe(false);
		stop();
	});

	it('keeps an explicit default key in the URL when asked to omit the default', () => {
		open('?tab=charts');
		const stop = $effect.root(() => {
			createUrlTab({ keys: ['charts', 'visits'], omitDefault: true });
		});
		flushSync();
		expect(gotoMock).not.toHaveBeenCalled();
		stop();
	});

	it('writes back a switch made after go() to the tab already open', () => {
		open('?tab=visits');
		let tab!: ReturnType<typeof createUrlTab>;
		const stop = $effect.root(() => {
			tab = createUrlTab({ keys: ['charts', 'visits'] });
		});
		flushSync();
		tab.go('visits', (url) => url.searchParams.set('event', 'e1'));
		flushSync();
		tab.index = 0;
		flushSync();
		tab.index = 1;
		flushSync();
		expect(lastUrl().searchParams.get('tab')).toBe('visits');
		stop();
	});

	it('stamps the open tab onto a bare URL navigated to under it', () => {
		open('?tab=visits');
		let tab!: ReturnType<typeof createUrlTab>;
		const stop = $effect.root(() => {
			tab = createUrlTab({ keys: ['charts', 'visits'], omitDefault: true });
		});
		flushSync();
		(page as { url: URL }).url = new URL('http://localhost/admin/sites/2');
		flushSync();
		expect(tab.key).toBe('visits');
		expect(lastUrl().pathname).toBe('/admin/sites/2');
		expect(lastUrl().searchParams.get('tab')).toBe('visits');
		stop();
	});

	it('leaves a bare URL alone when the default tab is open', () => {
		open('');
		const stop = $effect.root(() => {
			createUrlTab({ keys: ['charts', 'visits'], omitDefault: true });
		});
		flushSync();
		(page as { url: URL }).url = new URL('http://localhost/admin/sites/2');
		flushSync();
		expect(gotoMock).not.toHaveBeenCalled();
		stop();
	});
});
