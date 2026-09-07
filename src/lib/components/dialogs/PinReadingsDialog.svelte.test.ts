import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pinReadings = vi.fn();
const rollbackPinSet = vi.fn();
vi.mock('$api/service', () => ({
	pinReadings: (...a: unknown[]) => pinReadings(...a),
	rollbackPinSet: (...a: unknown[]) => rollbackPinSet(...a),
}));

const list = vi.fn();
vi.mock('$api/crud', () => ({
	api: { sensors: { list: () => list() }, sensorCalibrations: { list: () => list() } },
}));

const PinReadingsDialog = (await import('./PinReadingsDialog.svelte')).default;

beforeEach(() => {
	vi.clearAllMocks();
	list.mockResolvedValue({ data: [] });
});

function open() {
	return render(PinReadingsDialog, {
		open: true,
		siteId: 'site-1',
		parameterId: 'param-1',
		parameterName: 'Dissolved oxygen',
	});
}

describe('PinReadingsDialog', () => {
	it('will not pin until a target and a window are given', async () => {
		open();
		const button = (await screen.findByText('Pin the window')).closest('button');
		expect(button?.disabled).toBe(true);
	});

	it('states the consequence and that the set is reversible', async () => {
		const { container } = open();
		await screen.findByText('Pin the window');
		expect(container.textContent).toContain('honours it instead of resolving the window');
		expect(container.textContent).toContain('reversible from here');
	});

	it('asks what happens to a curve the incoming instrument does not own, and answers it', async () => {
		list.mockResolvedValue({ data: [{ id: 'a', name: 'Analyser B', kind: 'device' }] });
		pinReadings.mockRejectedValueOnce(
			new Error('2 of the selected readings are corrected by 1 standard curve(s) the incoming instrument does not own'),
		);
		const { container } = open();
		await screen.findByText('Pin the window');
		await fireEvent.change(await screen.findByLabelText('Instrument'), { target: { value: 'a' } });
		await fireEvent.input(await screen.findByLabelText('From'), {
			target: { value: '2026-07-01T00:00' },
		});
		await fireEvent.input(await screen.findByLabelText('To'), {
			target: { value: '2026-07-31T00:00' },
		});
		await fireEvent.click(screen.getByText('Pin the window'));

		expect(await screen.findByText('Copy the curves over')).toBeTruthy();
		expect(screen.getByText('Leave them with no curve')).toBeTruthy();
		expect(container.textContent).toContain('belongs to one instrument');

		pinReadings.mockResolvedValueOnce({ set_id: 's1', rows_decided: 2, jobs: ['j1'] });
		await fireEvent.click(screen.getByText('Copy the curves over'));
		await screen.findByText('Roll the set back');
		expect(pinReadings.mock.calls.at(-1)?.[4]).toBe('copy');
	});

	it('mints the instrument with the pin when the readings belong to one the inventory lacks', async () => {
		list.mockResolvedValue({ data: [{ id: 'a', name: 'Analyser B', kind: 'lab' }] });
		const { container } = open();
		await screen.findByText('Pin the window');
		await fireEvent.change(await screen.findByLabelText('Instrument'), {
			target: { value: 'new' },
		});
		expect(container.textContent).toContain('no calibration and no curve');
		await fireEvent.input(await screen.findByLabelText('Name'), {
			target: { value: 'Analyser C' },
		});
		await fireEvent.input(await screen.findByLabelText('From'), {
			target: { value: '2026-07-01T00:00' },
		});
		await fireEvent.input(await screen.findByLabelText('To'), {
			target: { value: '2026-07-31T00:00' },
		});
		pinReadings.mockResolvedValueOnce({
			set_id: 's1',
			target_id: 'minted',
			rows_decided: 4,
			jobs: [],
		});
		await fireEvent.click(screen.getByText('Pin the window'));
		await screen.findByText('Roll the set back');
		expect(pinReadings.mock.calls.at(-1)?.[1]).toEqual({
			new_instrument: { name: 'Analyser C', serial_number: undefined, kind: 'lab' },
		});
	});

	it('offers only instruments something was measured on', async () => {
		list.mockResolvedValue({
			data: [
				{ id: 'a', name: 'Field probe', kind: 'device' },
				{ id: 'b', name: 'Martigny DO (grab entry)', kind: 'entry_channel' },
			],
		});
		open();
		expect(await screen.findByText('Field probe')).toBeTruthy();
		expect(screen.queryByText('Martigny DO (grab entry)')).toBeNull();
	});
});
