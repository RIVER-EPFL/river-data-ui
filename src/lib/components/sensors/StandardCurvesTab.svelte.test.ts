import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ manager: false }));
const getInstrumentsOverview = vi.hoisted(() => vi.fn());

vi.mock('$auth/me.svelte', () => ({
	me: {
		can: (capability: string) => capability === 'manageSensors' && state.manager,
	},
}));

vi.mock('$api/crud', () => ({
	api: {
		standardCurves: {
			list: vi.fn().mockResolvedValue({ data: [], total: 0 }),
		},
	},
}));

vi.mock('$api/service', () => ({
	getCurveUsage: vi.fn(),
	getInstrumentsOverview,
	getSensorCurveUsage: vi.fn().mockResolvedValue({ usage: [] }),
	retireStandardCurve: vi.fn(),
	unretireStandardCurve: vi.fn(),
}));

const StandardCurvesTab = (await import('./StandardCurvesTab.svelte')).default;

afterEach(() => {
	cleanup();
	state.manager = false;
	getInstrumentsOverview.mockReset();
});

describe('instrument inspection access', () => {
	it('does not load sync inspection for a non-manager', async () => {
		render(StandardCurvesTab, { sensorId: 'sensor-1', sensorName: 'Probe' });

		await waitFor(() => expect(screen.getByText('No standard curves on this instrument.')).toBeTruthy());
		expect(screen.queryByText('Incoming streams')).toBeNull();
		expect(getInstrumentsOverview).not.toHaveBeenCalled();
	});

	it('shows the consolidated sync inspection to a manager', async () => {
		state.manager = true;
		getInstrumentsOverview.mockResolvedValue({
			instruments: [{ id: 'sensor-1', streams: [], curves: [] }],
		});

		render(StandardCurvesTab, { sensorId: 'sensor-1', sensorName: 'Probe' });

		await waitFor(() => expect(screen.getByText('Incoming streams')).toBeTruthy());
		expect(getInstrumentsOverview).toHaveBeenCalledOnce();
	});
});
