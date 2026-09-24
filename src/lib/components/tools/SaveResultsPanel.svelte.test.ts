import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';

// Every read resolves empty but the catalog and the site's parameters, which map the output `out`.
const resource = (name: string | symbol) =>
	new Proxy({}, { get: (_, key) => (key === 'name' ? name : async () => ({ data: [], total: 0 })) });
vi.mock('$api/crud', () => ({ api: new Proxy({}, { get: (_, name) => resource(name) }) }));
vi.mock('$api/paged', () => ({
	listAll: async (resource: { name: string }) =>
		({
			parameters: [{ id: 'p-out', code: 'out', name: 'Out', aliases: [] }],
			siteParameters: [{ id: 'sp-out', site_id: 'site-1', parameter_id: 'p-out', name: 'Out' }],
		})[resource.name] ?? [],
}));
vi.mock('$api/service', () => ({
	saveGrabSample: async () => ({ preview: [], existing_groups: [], calculations: [] }),
	grabConflictGroups: () => null,
	seasonalCheck: async () => ({ check_id: 'check-1', findings: [], method: {} }),
	getLastUsedCurve: async () => {
		throw new Error('none');
	},
}));
vi.mock('$lib/stores/toast.svelte', () => ({ toastStore: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('$auth/me.svelte', () => ({ me: { can: () => true, level: 3, data: null } }));

const SaveResultsPanel = (await import('./SaveResultsPanel.svelte')).default;

const props = {
	open: false,
	toolName: 'doubler',
	results: { out: 28 },
	outputs: [{ key: 'out', label: 'Out', parameter_id: 'p-out', per_replicate: false }],
	toolParams: [{ name: 'in', label: 'In', kind: 'number', units: null, required: true, default: null, when: null }],
	eventInputs: [{ param: 'in', parameter_code: 'in_code' }],
	visitCells: [{ parameter_code: 'in_code', parameter_id: 'p-in', served_value: 10 }],
	calcInputs: null,
	contextSiteId: 'site-1',
	contextTime: '2026-09-16T09:00:00Z',
	visitLocked: true,
};

describe('SaveResultsPanel', () => {
	// Scenario: Data entry previews while values are typed and stores the run only on Save, so the
	// run's inputs arrive in the same update that opens the dialog.
	it('carries the typed-over input a save corrects, when the inputs arrive as the dialog opens', async () => {
		const view = render(SaveResultsPanel, props as never);
		await tick();
		await view.rerender({ ...props, open: true, calcInputs: { in: 14 } } as never);
		await tick();

		const note = await screen.findByText('corrects In 10 to 14');
		const row = note.closest('tr')!;
		const box = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
		expect(box.checked).toBe(true);
	});

	it("holds the bar's Save until a check covers the values on screen", async () => {
		const view = render(SaveResultsPanel, { ...props, onsave: () => {} } as never);
		const save = (await screen.findByRole('button', { name: 'Save to Site' })) as HTMLButtonElement;
		expect(save.disabled).toBe(true);
		expect(save.title).toBe('Check these values against the site history first');

		const check = screen.getByRole('button', { name: 'Check against site history' }) as HTMLButtonElement;
		await vi.waitFor(() => expect(check.disabled).toBe(false));
		await fireEvent.click(check);
		await vi.waitFor(() => expect(save.disabled).toBe(false));

		await view.rerender({ ...props, onsave: () => {}, results: { out: 29 } } as never);
		await tick();
		const resaved = screen.getByRole('button', { name: 'Save to Site' }) as HTMLButtonElement;
		expect(resaved.disabled).toBe(true);
	});
});
