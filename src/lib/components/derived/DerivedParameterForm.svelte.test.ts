import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();
const get = vi.fn();
const list = vi.fn();
const thresholdCreate = vi.fn();

vi.mock('$api/crud', () => ({
	api: {
		derivedParameters: {
			create: (v: unknown) => create(v),
			get: (id: string) => get(id),
			update: vi.fn()
		},
		parameters: { list: () => list() },
		sites: { list: () => list() },
		siteParameters: { list: () => list() },
		constants: { list: () => list() },
		alarmThresholds: { create: (v: unknown) => thresholdCreate(v), update: vi.fn(), list: () => list() }
	}
}));
vi.mock('$lib/stores/toast.svelte', () => ({
	toastStore: { success: vi.fn(), error: vi.fn() }
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/components/derived/LivePreview.svelte', async () => ({
	default: (await import('./PreviewChartStub.test.svelte')).default
}));

const DerivedParameterForm = (await import('./DerivedParameterForm.svelte')).default;

describe('DerivedParameterForm', () => {
	beforeEach(() => {
		create.mockReset();
		get.mockReset();
		list.mockReset();
		list.mockResolvedValue({ data: [] });
		create.mockResolvedValue({ id: 'def-1', output_parameter_id: 'param-1' });
	});

	it('creates a definition from the fields as typed', async () => {
		render(DerivedParameterForm, { mode: 'create' });
		await fireEvent.input(await screen.findByPlaceholderText('e.g. DOmgL'), {
			target: { value: 'DOmgL' }
		});
		await fireEvent.input(screen.getByPlaceholderText('e.g. mg/L'), { target: { value: 'mg/L' } });
		await fireEvent.input(screen.getByPlaceholderText('Optional description'), {
			target: { value: 'oxygen' }
		});
		await fireEvent.input(screen.getByPlaceholderText(/Type formula directly/), {
			target: { value: 'Dissolved_O2 * 0.032' }
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Create' }));
		await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
		// Opened without a calculation, the form authors a standalone definition: the per-reading
		// continuous kind, belonging to no calculation and so carrying no ordinal in one.
		expect(create).toHaveBeenCalledWith({
			code: 'DOmgL',
			name: 'DOmgL',
			units: 'mg/L',
			formula: 'Dissolved_O2 * 0.032',
			description: 'oxygen',
			tool_script_id: null,
			ordinal: 0
		});
	});

	it('does not submit without a code and a formula', async () => {
		render(DerivedParameterForm, { mode: 'create' });
		await fireEvent.input(await screen.findByPlaceholderText('e.g. DOmgL'), {
			target: { value: 'DOmgL' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Create' }));
		expect(create).not.toHaveBeenCalled();
	});
});
