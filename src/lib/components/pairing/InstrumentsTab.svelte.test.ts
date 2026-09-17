import { render, screen } from '@testing-library/svelte';
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
		props: { instrumentDecisions: rows, ...over } as never,
	});
}

describe('InstrumentsTab lab instruments', () => {
	it('links each parameter and site an instrument covers, naming three sites and counting the rest', () => {
		mount({
			coverage: new Map([['doc', { parameters: ['DOC'], sites: ['Evolène', 'Martigny', 'Saxon', 'Verbier'] }]]),
		});
		expect(screen.getByRole('button', { name: 'DOC' }).getAttribute('title')).toBe('Open on the Parameters tab');
		const row = screen.getByRole('button', { name: 'Saxon' }).closest('tr');
		expect(row?.textContent).toMatch(/at\s*Evolène,\s*Martigny,\s*Saxon\s*and 1 more/);
		expect(screen.queryByRole('button', { name: 'Verbier' })).toBeNull();
	});
});

describe('InstrumentsTab devices', () => {
	it('lists one row per channel of a multi-channel device, above the lab instruments', () => {
		mount({
			planDevices: [channel('DDOuM', 'Dissolved oxygen'), channel('DDOTdegC', 'Temperature')],
		});
		const table = screen.getByRole('columnheader', { name: 'Covers' }).closest('table');
		const covers = [...(table?.querySelectorAll('tbody tr') ?? [])].map((tr) => tr.textContent ?? '');
		expect(covers.length).toBe(5);
		expect(covers[0]).toMatch(/Dissolved oxygen\s*at\s*Les Dailles\s*, device 25284028 RFL100/);
		expect(covers[1]).toMatch(/Temperature/);
	});
});

describe('InstrumentsTab device proposals', () => {
	it('offers a channel the apply will create for review, and counts it as needing one', () => {
		const device = channel('DDOuM', 'Dissolved oxygen');
		const group = {
			scope: 'instrument:DDOuM',
			instrument_id: null,
			name: 'Les Dailles Dissolved oxygen',
			source_key: 'DDOuM',
			resolved_by: 'device',
			create: true,
			confirmed: false,
			stamps_readings: false,
			curve_column: null,
			stream_count: 1,
			parameters: ['Dissolved oxygen'],
			site_count: 1,
			anchor_stream_id: device.anchor_stream_id,
			curves: [],
			proposed_name: 'Les Dailles Dissolved oxygen',
		};
		mount({
			instrumentDecisions: [],
			planDevices: [{ ...device, instrument: group }],
			deviceDecisions: [
				{
					key: group.scope,
					scope: group.scope,
					name: group.name,
					proposedName: group.name,
					group,
					parameters: group.parameters,
					siteCount: 1,
					streamCount: 1,
					anchorStreamId: device.anchor_stream_id,
					nameConflict: null,
				},
			],
		});
		expect(screen.getByRole('button', { name: 'Mark reviewed' })).not.toBeNull();
		expect(screen.getByRole('button', { name: 'Needs review 1' })).not.toBeNull();
	});
});
