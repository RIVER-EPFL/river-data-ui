import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Component } from 'svelte';

const sitesList = vi.fn();

vi.mock('$api/crud', () => ({
	api: { sites: { list: (...args: unknown[]) => sitesList(...args) } },
}));

const sites = [
	{ id: 'site-1', name: 'Martigny' },
	{ id: 'site-2', name: 'Saxon' },
];

// The catalog is cached per module instance, so each test gets a fresh graph. Testing Library
// comes with it: a component compiled against another copy of Svelte has no effect context.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let SiteSelect: Component<any>;
let render: typeof import('@testing-library/svelte').render;
let screen: typeof import('@testing-library/svelte').screen;
let cleanup: typeof import('@testing-library/svelte').cleanup;

describe('SiteSelect', () => {
	beforeEach(async () => {
		vi.resetModules();
		sitesList.mockReset().mockResolvedValue({ data: sites, total: sites.length });
		SiteSelect = (await import('./SiteSelect.svelte')).default;
		({ render, screen, cleanup } = await import('@testing-library/svelte'));
	});

	afterEach(() => cleanup());

	it('reads the catalog once however many pickers are mounted', async () => {
		render(SiteSelect, { value: '' });
		render(SiteSelect, { value: '' });
		expect(await screen.findAllByRole('option', { name: 'Saxon' })).toHaveLength(2);
		expect(sitesList).toHaveBeenCalledTimes(1);
	});

	it('emits the selected id', async () => {
		const onchange = vi.fn();
		render(SiteSelect, { value: '', onchange });
		const select = (await screen.findByLabelText('Site')) as HTMLSelectElement;
		select.value = 'site-2';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		await vi.waitFor(() => expect(onchange).toHaveBeenCalledWith('site-2'));
	});

	it('takes a host-held list without reading the catalog', async () => {
		render(SiteSelect, { value: '', sites: [{ id: 'site-3', name: 'Verbier' }] });
		expect(await screen.findByRole('option', { name: 'Verbier' })).toBeTruthy();
		expect(sitesList).not.toHaveBeenCalled();
	});

	it('says after a name what a host tells it, and nothing when the host says nothing', async () => {
		render(SiteSelect, {
			value: '',
			sites: [{ id: 'site-3', name: 'Verbier' }],
			note: (s: { id: string }) => (s.id === 'site-3' ? 'measures all 2' : ''),
		});
		expect(await screen.findByRole('option', { name: 'Verbier · measures all 2' })).toBeTruthy();
		cleanup();
		render(SiteSelect, { value: '', sites: [{ id: 'site-3', name: 'Verbier' }] });
		expect(await screen.findByRole('option', { name: 'Verbier' })).toBeTruthy();
	});
});
