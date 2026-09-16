import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';

// Every read the panel makes resolves empty: what is under test is which rows the save carries.
const empty = () => new Proxy({}, { get: () => async () => ({ data: [], total: 0 }) });
vi.mock('$api/crud', () => ({ api: new Proxy({}, { get: () => empty() }) }));
vi.mock('$api/paged', () => ({ listAll: async () => [] }));
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
});
