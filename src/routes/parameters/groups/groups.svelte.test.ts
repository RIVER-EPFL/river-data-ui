import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { page } from '$app/state';

// Expected behaviour: a group's name, description and order are editable after it is created, so a
// label typed in haste is corrected rather than needing the group deleted and rebuilt.

const GROUP_ID = '11111111-1111-4111-8111-111111111111';

const group = {
	id: GROUP_ID,
	code: 'headspace',
	label: 'headspace',
	description: null,
	ordinal: 3,
};

vi.mock('$auth/me.svelte', () => ({ me: { can: () => true } }));
vi.mock('$components/audit/ChangeTrail.svelte', async () => ({
	default: (await import('../../../lib/components/derived/PreviewChartStub.test.svelte')).default,
}));
vi.mock('$api/service', () => ({
	getGroupDefinition: async () => ({ id: GROUP_ID, members: [], calculations: [] }),
}));
vi.mock('$api/crud', () => ({
	api: {
		parameterGroups: {
			get: async () => group,
			list: async () => ({ data: [group], total: 1 }),
		},
		parameterGroupMembers: { list: async () => ({ data: [], total: 0 }) },
		parameters: { list: async () => ({ data: [], total: 0 }) },
	},
}));

page.params.id = GROUP_ID;

const Detail = (await import('./[id]/+page.svelte')).default;
const Edit = (await import('./[id]/edit/+page.svelte')).default;

describe('a group after creation', () => {
	it('offers its own edit form, not only deletion', async () => {
		render(Detail);
		const edit = await screen.findByRole('link', { name: 'Edit group' });
		expect(edit.getAttribute('href')).toBe(`/admin/parameters/groups/${GROUP_ID}/edit`);
	});

	it('edits the name, the description and the order', async () => {
		render(Edit);
		for (const label of ['Code', 'Label', 'Description', 'Order']) {
			expect(await screen.findByLabelText(new RegExp(`^${label}`)), label).toBeTruthy();
		}
	});

	// The code is the natural key a pairing plan resolves a group by
	// (`sync/service.rs`: `parameter_groups::Column::Code.eq(group.code)`), so a rename splits the
	// group in two at the next plan unless the source is renamed with it.
	it('says what renaming the code costs', async () => {
		render(Edit);
		expect(await screen.findByText(/pairing plan/i)).toBeTruthy();
	});
});
