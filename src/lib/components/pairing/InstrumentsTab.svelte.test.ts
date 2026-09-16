import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/paths', () => ({ base: '' }));

const Harness = (await import('./InstrumentsTabHarness.test.svelte')).default;

function decision(key: string, parameters: string[]) {
	return {
		key,
		scope: key,
		name: parameters[0],
		proposedName: parameters[0],
		group: null,
		parameters,
		siteCount: 3,
		streamCount: 3,
		anchorStreamId: `stream-${key}`,
		nameConflict: null,
	};
}

const rows = [decision('doc', ['DOC']), decision('chla', ['Chl a']), decision('tn', ['TN'])];

// A Vaisala logger serves several channels under one serial, and each channel is its own row.
function channel(sourceKey: string, parameter: string) {
	return {
		site: 'Les Dailles',
		serial: '25284028',
		model: 'RFL100',
		instrument_id: null,
		instrument_name: null,
		parameters: [parameter],
		stream_count: 1,
		anchor_stream_id: `stream-${sourceKey}`,
	};
}

function mount(over: Record<string, unknown> = {}) {
	return render(Harness, {
		props: {
			instrumentDecisions: rows,
			labInstruments: [{ id: 'lab-1', name: 'Lab analyser', serial_number: null }],
			onassign: vi.fn(),
			...over,
		} as never,
	});
}

async function select(label: string) {
	await fireEvent.click(screen.getByLabelText(`Select ${label}`));
}

describe('InstrumentsTab bulk assignment', () => {
	it('assigns one instrument to every selected row in one action', async () => {
		const onassign = vi.fn();
		mount({ onassign });
		await select('DOC');
		await select('TN');
		expect(screen.getByText('2 selected')).not.toBeNull();

		const picker = screen.getByLabelText(
			'Instrument to assign to the selected parameters',
		) as HTMLSelectElement;
		await fireEvent.change(picker, { target: { value: 'lab-1' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Assign' }));

		expect(onassign).toHaveBeenCalledTimes(1);
		const [chosen, instrumentId] = onassign.mock.calls[0];
		expect(chosen.map((d: { key: string }) => d.key)).toEqual(['doc', 'tn']);
		expect(instrumentId).toBe('lab-1');
	});

	/// The same write read the other way: the bar says which parameters the chosen instrument will
	/// serve, so the instrument view and the parameter view cannot disagree about the assignment.
	it('names the parameters the instrument will serve before it is assigned', async () => {
		mount();
		await select('DOC');
		await select('Chl a');
		expect(screen.getByText(/It will serve DOC, Chl a\./)).not.toBeNull();
	});

	it('offers no assignment until an instrument is chosen', async () => {
		mount();
		await select('DOC');
		const assign = screen.getByRole('button', { name: 'Assign' }) as HTMLButtonElement;
		expect(assign.disabled).toBe(true);
	});

	it('selects and clears every row at once', async () => {
		mount();
		await fireEvent.click(screen.getByLabelText('Select every instrument row'));
		expect(screen.getByText('3 selected')).not.toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
		expect(screen.queryByText(/selected$/)).toBeNull();
	});
});

describe('InstrumentsTab devices', () => {
	it('lists one row per channel of a multi-channel device', () => {
		mount({
			planDevices: [channel('DDOuM', 'Dissolved oxygen'), channel('DDOTdegC', 'Temperature')],
		});
		const table = screen.getByRole('columnheader', { name: 'Channels' }).closest('table');
		expect(table?.querySelectorAll('tbody tr').length).toBe(2);
		expect(screen.getByText('Dissolved oxygen')).not.toBeNull();
		expect(screen.getByText('Temperature')).not.toBeNull();
	});
});
