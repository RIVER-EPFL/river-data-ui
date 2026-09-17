import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

import type { Reading } from '$api/crud';

const getReadingProvenance = vi.fn();
vi.mock('$api/service', () => ({
	getReadingProvenance: (q: unknown) => getReadingProvenance(q),
	getReadingDecisions: vi.fn().mockResolvedValue({ decisions: [] }),
	getReadingLedger: vi.fn().mockResolvedValue({ entries: [], truncated: false }),
	rollbackEdit: vi.fn(),
	rollbackEditSet: vi.fn(),
}));
vi.mock('$auth/me.svelte', () => ({ me: { can: () => true } }));

const ReadingsList = (await import('./ReadingsList.svelte')).default;

// Scenario: a scientist checking an import wants every reading with its raw and corrected value
// side by side and what corrected it, and opens one to read everything that happened to it.

function reading(over: Partial<Reading> = {}): Reading {
	return {
		stream_id: 'stream-1',
		time: '2026-09-10T08:00:00Z',
		replicate_index: 0,
		site_id: 'site-1',
		parameter_id: 'param-1',
		raw_value: 1.5,
		calibrated_value: 3.25,
		sensor_id: 'sensor-1',
		calibration_id: 'cal-1',
		standard_curve_id: 'curve-1',
		deployment_id: null,
		logged: null,
		measurement_type: 'spot',
		is_flagged: false,
		flag_reason: null,
		sample_id: null,
		collection_event_id: null,
		withdrawn_at: null,
		withdrawn_reason: null,
		ingested_at: '2026-09-10T09:00:00Z',
		provenance_kind: 'sync',
		provenance: null,
		label: null,
		notes: null,
		created_by: null,
		unverified: false,
		derived_version_id: null,
		source_system: 'cnet',
		source_key: 'FP1:DOC',
		site_name: 'FP1',
		parameter_code: 'DOC',
		units: 'ppb',
		instrument_name: 'Shimadzu TOC',
		calibration: { id: 'cal-1', name: 'Spring check', slope: 2, intercept: 0.25, valid_from: '2026-01-01T00:00:00Z', valid_until: null },
		curve: { id: 'curve-1', name: 'DOC 2026-09', slope: 1.1, intercept: 0 },
		...over,
	} as Reading;
}

function mount(rows: Reading[]) {
	const load = vi.fn().mockResolvedValue({ data: rows, total: rows.length });
	render(ReadingsList, {
		props: {
			sites: [{ id: 'site-1', name: 'FP1' }] as never,
			parameters: [{ id: 'param-1', code: 'DOC', name: 'DOC', default_units: 'ppb' }] as never,
			instruments: [{ id: 'sensor-1', name: 'Shimadzu TOC', serial_number: null }] as never,
			curves: [{ id: 'curve-1', name: 'DOC 2026-09', slope: 1.1, intercept: 0 }] as never,
			load,
		},
	});
	return load;
}

describe('ReadingsList', () => {
	it('shows the raw and the calibrated value as two columns', async () => {
		mount([reading()]);
		expect(await screen.findByText('1.5')).not.toBeNull();
		expect(screen.getByText('3.25')).not.toBeNull();
		expect(screen.getByText('Raw')).not.toBeNull();
		expect(screen.getByText('Calibrated')).not.toBeNull();
	});

	it('links the instrument, its calibration and the curve to their pages', async () => {
		mount([reading()]);
		const instrument = (await screen.findByText('Shimadzu TOC', { selector: 'a' })) as HTMLAnchorElement;
		expect(instrument.getAttribute('href')).toMatch(/\/sensors\/sensor-1$/);
		expect(screen.getByText('Spring check').getAttribute('href')).toMatch(/\/sensors\/sensor-1\?tab=calibrations&cal=cal-1$/);
		expect(screen.getByText('DOC 2026-09', { selector: 'a' }).getAttribute('href')).toMatch(/\/sensors\/sensor-1\?tab=curves&curve=curve-1$/);
	});

	it('asks for the last seven days and nothing else by default', async () => {
		const load = mount([]);
		await screen.findByText('No readings match');
		const filter = load.mock.calls[0]?.[0].filter as Record<string, unknown>;
		expect(Object.keys(filter)).toEqual(['time_gte']);
	});

	it('filters by the selected standard curve', async () => {
		const load = mount([]);
		await screen.findByText('No readings match');
		await fireEvent.change(screen.getByLabelText('Standard curve'), { target: { value: 'curve-1' } });
		expect(load).toHaveBeenLastCalledWith(expect.objectContaining({
			filter: expect.objectContaining({ standard_curve_id: 'curve-1' }),
		}));
	});

	it('opens the point record under the row', async () => {
		getReadingProvenance.mockResolvedValue({ records: [], duplicate_slot: false });
		mount([reading()]);
		await fireEvent.click(await screen.findByText('1.5'));
		expect(await screen.findByTestId('point-record')).not.toBeNull();
		expect(getReadingProvenance).toHaveBeenCalledWith(
			expect.objectContaining({ site_id: 'site-1', parameter_id: 'param-1', time: '2026-09-10T08:00:00Z' }),
		);
	});

	it('says an unpaired reading has no record yet', async () => {
		mount([reading({ site_id: null, site_name: null, parameter_id: null })]);
		await fireEvent.click(await screen.findByText('1.5'));
		expect(await screen.findByText('An unpaired reading has no record until its stream is paired.')).not.toBeNull();
	});
});
