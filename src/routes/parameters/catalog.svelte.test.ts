import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$auth/me.svelte', () => ({ me: { can: (capability: string) => capability !== 'admin' } }));
vi.mock('$components/parameters/ParameterCatalogList.svelte', async () => ({
	default: (await import('../../lib/components/derived/PreviewChartStub.test.svelte')).default
}));

const Catalog = (await import('./+page.svelte')).default;
const NewDerived = (await import('../derived/new/+page.svelte')).default;
const NewGroup = (await import('./groups/new/+page.svelte')).default;

describe('manager catalog access', () => {
	it('offers parameter creation without calculation authoring', () => {
		render(Catalog);
		expect(screen.getByRole('link', { name: 'Create parameter' })).toBeTruthy();
		expect(screen.queryByRole('link', { name: 'Create derived parameter' })).toBeNull();
	});

	it.each([NewDerived, NewGroup])('refuses direct authoring links', (component) => {
		render(component);
		expect(screen.getByText('Authoring calculations requires the Administrator role.')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Create' })).toBeNull();
	});
});
