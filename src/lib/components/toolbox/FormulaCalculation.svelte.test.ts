import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Scenario: a calculation is read over dummy values before it is saved (M294).
//
// Expected behaviour: the preview goes through `draft_run` and nothing else, so no reading,
// parameter, version or tool run is written by looking at the numbers.

const result = (value: number) => ({
	ran: true,
	skipped: [],
	trace: [],
	event_inputs: [],
	site_inputs: [],
	constants: {},
	curves: [],
	failure: null,
	manifest: { outputs: [] },
	results: { hs_k: value },
});
const pending: Array<(value: unknown) => void> = [];
const draftRunFormulas = vi.fn(
	(_id: string, _body: unknown) => new Promise((resolve) => pending.push(resolve)),
);
const saveFormulaSet = vi.fn();
const writes = vi.fn();

vi.mock('$api/service', () => ({
	draftRunFormulas: (id: string, body: unknown) => draftRunFormulas(id, body),
	saveFormulaSet: (...args: unknown[]) => saveFormulaSet(...args),
	getStepDependents: vi.fn(async () => ({ calculations: [] })),
	getToolScript: vi.fn(async () => ({
		id: 'calc-1',
		name: 'pco2',
		label: 'pCO2',
		description: null,
		enabled: true,
		active_version_no: null,
		versions: [],
	})),
	listSiteVisits: vi.fn(async () => ({ visits: [] })),
	listToolVersionUsage: vi.fn(async () => []),
	previewDerived: vi.fn(async () => ({
		site: { id: 's1', name: 'Martigny' },
		times: [],
		source_parameters: [],
		formulas: [],
	})),
}));

const entity = (rows: unknown[] = []) => ({
	list: vi.fn(async () => ({ data: rows, total: rows.length })),
	create: (...a: unknown[]) => writes('create', ...a),
	update: (...a: unknown[]) => writes('update', ...a),
	remove: (...a: unknown[]) => writes('remove', ...a),
});

vi.mock('$api/crud', () => ({
	SITE_PROPERTIES: ['altitude_m'],
	api: {
		derivedParameters: entity([
			{
				id: 'f1',
				code: 'hs_k',
				name: 'HS k',
				units: '',
				description: null,
				formula: 'lab_temp * 2',
				ordinal: 1,
				curve_slot: null,
				per_replicate: null,
				intermediate: false,
				code_locked: null,
			},
		]),
		parameters: entity([
			{
				id: 'p1',
				code: 'lab_temp',
				name: 'Lab temperature',
				default_units: 'degC',
				category: 'measurement',
			},
		]),
		constants: entity(),
		parameterGroupMembers: entity(),
		calculationSharedSteps: entity(),
		sites: entity([{ id: 's1', name: 'Martigny' }]),
		siteParameters: entity([{ id: 'sp1', site_id: 's1', parameter_id: 'p1', is_active: true }]),
		alarmThresholds: entity(),
		standardCurves: entity(),
		sensors: entity(),
		sensorCalibrations: entity(),
	},
}));

vi.mock('$api/paged', () => ({
	listAll: async (resource: { list: (q: unknown) => Promise<{ data: unknown[] }> }) =>
		(await resource.list({})).data,
}));
vi.mock('$app/paths', () => ({ base: '' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/toolbox/calc-1') } }));

const FormulaCalculation = (await import('./FormulaCalculation.svelte')).default;

beforeEach(() => {
	draftRunFormulas.mockClear();
	saveFormulaSet.mockClear();
	writes.mockClear();
	pending.length = 0;
});

describe('reading a calculation over its values', () => {
	it('previews through draft_run alone, and writes nothing', async () => {
		render(FormulaCalculation, { calculationId: 'calc-1' });
		await waitFor(() => expect(draftRunFormulas).toHaveBeenCalled());
		pending.shift()?.(result(2));
		expect(saveFormulaSet).not.toHaveBeenCalled();
		expect(writes).not.toHaveBeenCalled();
	});

	it('runs on the typed numbers alone when no visit is chosen', async () => {
		render(FormulaCalculation, { calculationId: 'calc-1' });
		await waitFor(() => expect(draftRunFormulas).toHaveBeenCalled());
		pending.shift()?.(result(2));
		const body = draftRunFormulas.mock.calls.at(-1)?.[1] as {
			inputs: Record<string, unknown>;
		};
		expect(body.inputs.site_id).toBeUndefined();
		expect(body.inputs.collected_at).toBeUndefined();
	});
});

describe('two runs in flight', () => {
	it('keeps the later run`s numbers when an earlier one answers after it', async () => {
		const view = render(FormulaCalculation, { calculationId: 'calc-1' });
		await waitFor(() => expect(draftRunFormulas).toHaveBeenCalledTimes(1));
		await userEvent.click(await screen.findByRole('button', { name: 'Run' }));
		await waitFor(() => expect(draftRunFormulas).toHaveBeenCalledTimes(2));

		const [first, second] = pending.splice(0, 2);
		second!(result(20));
		await waitFor(() => expect(view.container.textContent).toContain('20'));
		first!(result(10));
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(view.container.textContent).toContain('20');
		expect(view.container.textContent).not.toContain('10');
	});
});

describe('a calculation that corrects with a curve', () => {
	const withSlot = [
		{
			id: 'f1',
			code: 'DOC',
			name: 'DOC',
			units: 'ppb',
			description: null,
			formula: 'lab_temp * curve_slope',
			ordinal: 1,
			curve_slot: 'doc',
			per_replicate: null,
			intermediate: false,
			code_locked: null,
		},
	];

	it('mounts its slot picker, so the block is exercised at all', async () => {
		const { api } = await import('$api/crud');
		(api.derivedParameters.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			data: withSlot,
			total: 1,
		});
		render(FormulaCalculation, { calculationId: 'calc-1' });
		await waitFor(() => expect(screen.getByText('Curve slot doc')).toBeTruthy());
	});
});

describe('reading a calculation over a site series', () => {
	it('offers the series when every input is a parameter a site streams', async () => {
		render(FormulaCalculation, { calculationId: 'calc-1' });
		await waitFor(() => expect(screen.getByText("Over a site's series")).toBeTruthy());
		expect(screen.getByText(/Move along the chart/)).toBeTruthy();
	});
});
