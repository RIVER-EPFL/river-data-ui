import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$auth/me.svelte', () => ({ me: { can: (capability: string) => capability !== 'admin' } }));
vi.mock('$components/parameters/ParameterCatalogList.svelte', async () => ({
	default: (await import('../../lib/components/derived/PreviewChartStub.test.svelte')).default
}));

const Catalog = (await import('./+page.svelte')).default;
const NewGroup = (await import('./groups/new/+page.svelte')).default;

describe('manager catalog access', () => {
	it('offers parameter creation, and no route into calculation authoring', () => {
		render(Catalog);
		expect(screen.getByRole('link', { name: 'Create parameter' })).toBeTruthy();
		expect(screen.queryByRole('link', { name: /derived/i })).toBeNull();
	});

	it('refuses a direct authoring link', () => {
		render(NewGroup);
		expect(screen.getByText('Authoring calculations requires the Administrator role.')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Create' })).toBeNull();
	});
});
