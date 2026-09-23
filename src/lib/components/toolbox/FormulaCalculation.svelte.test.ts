import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
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
const listVersionLedger = vi.fn(async (_id: string): Promise<unknown[]> => []);
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
	getSiteDetail: vi.fn(async () => ({ parameters: [] })),
	listSiteVisits: vi.fn(async () => ({ visits: [] })),
	listTools: vi.fn(async () => []),
	listToolVersionUsage: vi.fn(async () => []),
	listVersionLedger: (id: string) => listVersionLedger(id),
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
				output_parameter_id: 'p-out',
				sources: [
					{
						id: 's1',
						derived_definition_id: 'f1',
						parameter_id: 'p1',
						variable_name: 'lab_temp',
						alignment: 'hold',
						created_at: '',
					},
				],
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

// Every test here mounts the whole page and waits on the 400 ms rerun debounce, on real timers.
vi.setConfig({ testTimeout: 40_000 });
// How long a wait on that debounce may take on a loaded machine.
const settle = { timeout: 15_000 };

beforeEach(() => {
	draftRunFormulas.mockClear();
	saveFormulaSet.mockClear();
	writes.mockClear();
	pending.length = 0;
	listVersionLedger.mockResolvedValue([]);
});

describe('reading a calculation over its values', () => {
	it('previews through draft_run alone, and writes nothing', async () => {
		render(FormulaCalculation, { calculationId: 'calc-1' });
		await waitFor(() => expect(draftRunFormulas).toHaveBeenCalled(), settle);
		pending.shift()?.(result(2));
		expect(saveFormulaSet).not.toHaveBeenCalled();
		expect(writes).not.toHaveBeenCalled();
	});

	it('runs on the typed numbers alone when no visit is chosen', async () => {
		render(FormulaCalculation, { calculationId: 'calc-1' });
		await waitFor(() => expect(draftRunFormulas).toHaveBeenCalled(), settle);
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
		await waitFor(() => expect(draftRunFormulas).toHaveBeenCalledTimes(1), settle);
		// Editing the set is what reruns it: there is no Run button, the site and the visit are the
		// page's own, and a change reads the set again once it has settled.
		await fireEvent.click(await screen.findByRole('button', { name: 'Add output' }));
		await waitFor(() => expect(draftRunFormulas).toHaveBeenCalledTimes(2), settle);

		const [first, second] = pending.splice(0, 2);
		second!(result(20));
		await waitFor(() => expect(view.container.textContent).toContain('20'), settle);
		first!(result(10));
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(view.container.textContent).toContain('20');
		expect(view.container.textContent).not.toContain('10');
	});
});

// Scenario: the set reads a value the lab measures at a visit, declared held (Q230), and the
// author is about to save it.
//
// Expected behaviour: the save arm names the input and what it does between visits before the
// save, rather than leaving it to be found in the values afterwards.
describe('a set holding an input between visits', () => {
	it('names it and what it does, before the save', async () => {
		render(FormulaCalculation, { calculationId: 'calc-1' });
		const caveat = await screen.findByText(/lab_temp is held between visits/);
		expect(caveat.textContent).toContain('until the next visit measures a new one');
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
		await waitFor(() => expect(screen.getByText('Curve slot doc')).toBeTruthy(), settle);
	});
});

describe('reading a calculation over a site series', () => {
	it('offers the series when every input is a parameter a site streams', async () => {
		render(FormulaCalculation, { calculationId: 'calc-1' });
		await waitFor(() => expect(screen.getByText('Live preview')).toBeTruthy(), settle);
	});
});

// Scenario: the calculation has already computed on a site's stream under two pinned versions.
//
// Expected behaviour: the page lists one row per version with what it wrote and over what span,
// and each row links the output's readings over that span, where a row opens its record. A
// continuous evaluation records no identity of its own, so the row is the version and not the pass.
describe('what a calculation has computed on a stream', () => {
	it('lists a row per version, linking the output readings over its span', async () => {
		listVersionLedger.mockResolvedValue([
			{
				version_id: 'v2',
				version_no: 2,
				readings: 148,
				first_instant: '2026-02-01T00:00:00Z',
				last_instant: '2026-03-01T00:00:00Z',
				first_computed: '2026-02-01T01:00:00Z',
				last_computed: '2026-03-01T01:00:00Z',
			},
			{
				version_id: 'v1',
				version_no: 1,
				readings: 0,
				first_instant: null,
				last_instant: null,
				first_computed: null,
				last_computed: null,
			},
		]);
		render(FormulaCalculation, { calculationId: 'calc-1' });

		await screen.findByText('Version 2');
		expect(screen.getByText(/148 readings/)).toBeTruthy();
		const link = screen.getByRole('link', { name: 'hs_k' }) as HTMLAnchorElement;
		expect(link.getAttribute('href')).toContain('/readings?parameter=p-out');
		expect(link.getAttribute('href')).toContain('from=2026-02-01T00%3A00%3A00Z');

		expect(screen.getByText('Version 1')).toBeTruthy();
		expect(screen.getByText('Nothing stored under this version.')).toBeTruthy();
	});
});
