import { render, screen } from '@testing-library/svelte';
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
