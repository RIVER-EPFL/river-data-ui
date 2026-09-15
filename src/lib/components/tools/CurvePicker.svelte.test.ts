import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sensorsList = vi.fn();
const curvesList = vi.fn();
const curvesCreate = vi.fn();
const curvesGet = vi.fn();

vi.mock('$api/crud', () => ({
	api: {
		sensors: { list: (...args: unknown[]) => sensorsList(...args) },
		standardCurves: {
			list: (...args: unknown[]) => curvesList(...args),
			get: (...args: unknown[]) => curvesGet(...args),
			create: (...args: unknown[]) => curvesCreate(...args),
		},
	},
}));
const lastUsedCurve = vi.fn().mockRejectedValue(new Error('none'));
vi.mock('$api/service', () => ({ getLastUsedCurve: (...args: unknown[]) => lastUsedCurve(...args) }));
vi.mock('$lib/stores/toast.svelte', () => ({ toastStore: { success: vi.fn(), error: vi.fn() } }));
vi.mock('$auth/me.svelte', () => ({ me: { can: () => true, data: { email: 'evan@example.org' } } }));

const CurvePicker = (await import('./CurvePicker.svelte')).default;
const { emptyCurveSelection } = await import('./CurvePicker.svelte');

const instrument = { id: 'sensor-1', name: 'Lab DOC', serial_number: 'S1', is_active: true };

async function pickInstrument() {
	const select = (await screen.findByLabelText('DOC curve instrument')) as HTMLSelectElement;
	select.value = 'sensor-1';
	select.dispatchEvent(new Event('change', { bubbles: true }));
	await vi.waitFor(() => expect(curvesList).toHaveBeenCalled());
}

describe('CurvePicker', () => {
	beforeEach(() => {
		sensorsList.mockReset().mockResolvedValue({ data: [instrument], total: 1 });
		curvesList.mockReset().mockResolvedValue({ data: [], total: 0 });
		curvesCreate.mockReset();
	});

	it('offers a create control on an instrument carrying no curves', async () => {
		render(CurvePicker, { title: 'DOC curve', value: emptyCurveSelection() });
		await pickInstrument();
		expect(await screen.findByText('No standard curves on this instrument')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Add a curve to this instrument' })).toBeTruthy();
	});

	it('publishes a selection carrying the new curve rather than bare coefficients', async () => {
		curvesCreate.mockResolvedValue({
			id: 'curve-1',
			sensor_id: 'sensor-1',
			name: 'Plate 7',
			slope: 2,
			intercept: 1,
			r_squared: null,
			notes: null,
		});
		const props = $state({ title: 'DOC curve', value: emptyCurveSelection() });
		render(CurvePicker, props);
		await pickInstrument();

		(await screen.findByRole('button', { name: 'Add a curve to this instrument' })).click();
		const named = (n: string) => screen.getByLabelText(n) as HTMLInputElement;
		await vi.waitFor(() => expect(screen.getByText('New standard curve')).toBeTruthy());
		for (const [label, v] of [['Name', 'Plate 7'], ['Slope', '2'], ['Intercept', '1']] as const) {
			const input = named(label);
			input.value = v;
			input.dispatchEvent(new Event('input', { bubbles: true }));
		}
		screen.getByRole('button', { name: 'Add curve' }).click();

		await vi.waitFor(() => expect(curvesCreate).toHaveBeenCalledTimes(1));
		expect(curvesCreate.mock.calls[0][0]).toMatchObject({
			sensor_id: 'sensor-1',
			name: 'Plate 7',
			slope: 2,
			intercept: 1,
		});
		await vi.waitFor(() => expect(props.value.standardCurveId).toBe('curve-1'));
		expect(props.value.slope).toBe(2);
		expect(props.value.label).toBe('Plate 7');
	});
});

describe('the last curve used at the slot', () => {
	// A curve is never derived, defaulted or inherited: a stored `standard_curve_id` exists only
	// because a person picked that curve for that value, and no curve at all is a legitimate state.
	const curve = {
		id: 'curve-9',
		sensor_id: 'sensor-1',
		name: 'Plate 3',
		slope: 3,
		intercept: 0.5,
		r_squared: null,
		notes: null,
	};
	const last = {
		sensor_id: 'sensor-1',
		sensor_name: 'Lab DOC',
		standard_curve_id: 'curve-9',
		curve_name: 'Plate 3',
		curve_created_at: '2026-07-01T00:00:00Z',
		method: 'the newest grab at this slot',
	};

	beforeEach(() => {
		sensorsList.mockReset().mockResolvedValue({ data: [instrument], total: 1 });
		curvesList.mockReset().mockResolvedValue({ data: [curve], total: 1 });
		curvesCreate.mockReset();
		lastUsedCurve.mockReset().mockResolvedValue(last);
	});

	it('is offered and not applied, so an untouched picker carries no curve', async () => {
		const props = $state({
			title: 'DOC curve',
			value: emptyCurveSelection(),
			siteId: 'site-1',
			parameterId: 'p-doc',
		});
		render(CurvePicker, props);
		await vi.waitFor(() => expect(screen.getByText(/Last used here/)).toBeTruthy());
		await vi.waitFor(() => expect(curvesList).toHaveBeenCalled());
		expect(props.value.standardCurveId).toBeNull();
	});

	it('is taken when the operator takes it, which is the pick', async () => {
		const props = $state({
			title: 'DOC curve',
			value: emptyCurveSelection(),
			siteId: 'site-1',
			parameterId: 'p-doc',
		});
		render(CurvePicker, props);
		const use = await screen.findByRole('button', { name: 'Use this curve' });
		use.click();
		await vi.waitFor(() => expect(props.value.standardCurveId).toBe('curve-9'));
		expect(props.value.slope).toBe(3);
	});
});

describe('a slot reopened on a run that chose a stored curve', () => {
	// Q192: reopening a run replays what it chose, so a re-save moves the output only where the
	// person changed something. The selection arrives already made and the controls have to show it.
	const curve = {
		id: 'curve-9',
		sensor_id: 'sensor-1',
		name: 'Plate 3',
		slope: 3,
		intercept: 0.5,
		r_squared: null,
		notes: null,
	};
	// The shape a reopened run arrives in: `curveSelectionFrom` reads the run body's
	// `{ standard_curve_id }` and the body carries nothing else about the curve.
	const replayed = { standardCurveId: 'curve-9', slope: null, intercept: null, label: null };

	beforeEach(() => {
		sensorsList.mockReset().mockResolvedValue({ data: [instrument], total: 1 });
		curvesList.mockReset().mockResolvedValue({ data: [curve], total: 1 });
		curvesCreate.mockReset();
		curvesGet.mockReset().mockResolvedValue(curve);
		lastUsedCurve.mockReset().mockRejectedValue(new Error('none'));
	});

	it('opens the controls on the instrument and curve the run used', async () => {
		render(CurvePicker, { title: 'DOC curve', value: { ...replayed } });
		const instrumentSelect = (await screen.findByLabelText(
			'DOC curve instrument',
		)) as HTMLSelectElement;
		await vi.waitFor(() => expect(instrumentSelect.value).toBe('sensor-1'));
		const curveSelect = (await screen.findByLabelText('DOC curve curve')) as HTMLSelectElement;
		expect(curveSelect.value).toBe('curve-9');
	});

	it('keeps the run’s curve when a different one was last used at the slot', async () => {
		lastUsedCurve.mockReset().mockResolvedValue({
			sensor_id: 'sensor-2',
			sensor_name: 'Other bench',
			standard_curve_id: 'curve-2',
			curve_name: 'Plate 1',
			curve_created_at: '2026-07-01T00:00:00Z',
			method: 'the newest grab at this slot',
		});
		const props = $state({
			title: 'DOC curve',
			value: { ...replayed },
			siteId: 'site-1',
			parameterId: 'p-doc',
		});
		render(CurvePicker, props);
		await vi.waitFor(() => expect(screen.getByText(/Last used here/)).toBeTruthy());
		expect(props.value.standardCurveId).toBe('curve-9');
	});
});
