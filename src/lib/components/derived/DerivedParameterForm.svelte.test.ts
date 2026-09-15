import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();
const get = vi.fn();
const list = vi.fn();
const derivedList = vi.fn();
const sharedStepsList = vi.fn();
const thresholdCreate = vi.fn();

vi.mock('$api/crud', () => ({
	api: {
		derivedParameters: {
			create: (v: unknown) => create(v),
			get: (id: string) => get(id),
			list: (q: unknown) => derivedList(q),
			update: vi.fn()
		},
		calculationSharedSteps: { list: (q: unknown) => sharedStepsList(q) },
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
vi.mock('$api/service', () => ({ listToolScripts: () => Promise.resolve([]) }));
vi.mock('$lib/components/derived/LivePreview.svelte', async () => ({
	default: (await import('./PreviewChartStub.test.svelte')).default
}));

const DerivedParameterForm = (await import('./DerivedParameterForm.svelte')).default;

describe('DerivedParameterForm', () => {
	beforeEach(() => {
		create.mockReset();
		get.mockReset();
		list.mockReset();
		derivedList.mockReset();
		sharedStepsList.mockReset();
		sharedStepsList.mockResolvedValue({ data: [] });
		// The catalog the formula reads from: an identifier no parameter carries is a diagnostic
		// now, and the form holds Save while one stands.
		list.mockResolvedValue({
			data: [{ id: 'p-do', code: 'Dissolved_O2', name: 'Dissolved oxygen', default_units: 'uM' }]
		});
		derivedList.mockResolvedValue({ data: [] });
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
			per_replicate: null,
			curve_slot: null,
			intermediate: false,
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

	it('offers only the inputs a formula reads as a per-replicate choice', async () => {
		render(DerivedParameterForm, { mode: 'create' });
		await fireEvent.input(await screen.findByPlaceholderText(/Type formula directly/), {
			target: { value: 'coalesce(Dissolved_O2, na) + 273.15' }
		});
		const select = screen.getByLabelText('Per replicate over') as HTMLSelectElement;
		expect([...select.options].map((o) => o.value)).toEqual(['', 'Dissolved_O2']);
	});

	it('lints a step of the owning calculation clean', async () => {
		get.mockResolvedValue({
			id: 'def-1',
			code: 'CO2_Um',
			name: 'CO2',
			units: 'uM',
			formula: 'CO2_HS_Um * 2',
			description: null,
			per_replicate: null,
			curve_slot: null,
			intermediate: false,
			output_parameter_id: null,
			tool_script_id: 'calc-1'
		});
		derivedList.mockResolvedValue({
			data: [
				{ id: 'def-1', code: 'CO2_Um', formula: 'CO2_HS_Um * 2', tool_script_id: 'calc-1' },
				{ id: 'def-2', code: 'CO2_HS_Um', formula: 'lab_co2 * 1', tool_script_id: 'calc-1' }
			]
		});
		render(DerivedParameterForm, { mode: 'edit', defId: 'def-1' });
		const save = await screen.findByRole('button', { name: 'Save' });
		await vi.waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
	});
});
