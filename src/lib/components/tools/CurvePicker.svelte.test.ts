import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sensorsList = vi.fn();
const curvesList = vi.fn();
const curvesCreate = vi.fn();

vi.mock('$api/crud', () => ({
	api: {
		sensors: { list: (...args: unknown[]) => sensorsList(...args) },
		standardCurves: {
			list: (...args: unknown[]) => curvesList(...args),
			create: (...args: unknown[]) => curvesCreate(...args),
		},
	},
}));
vi.mock('$api/service', () => ({ getLastUsedCurve: vi.fn().mockRejectedValue(new Error('none')) }));
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
