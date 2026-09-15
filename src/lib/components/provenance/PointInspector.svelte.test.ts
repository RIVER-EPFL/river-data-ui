import { render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProvenanceResponse } from '$api/service';
import { formatDateTime } from '$lib/utils';

const getReadingProvenance = vi.fn();
const getReadingDecisions = vi.fn();
const getReadingLedger = vi.fn();
const rollbackEdit = vi.fn();
vi.mock('$api/service', () => ({
	getReadingProvenance: (q: unknown) => getReadingProvenance(q),
	getReadingDecisions: (q: unknown) => getReadingDecisions(q),
	getReadingLedger: (q: unknown) => getReadingLedger(q),
	rollbackEdit: (id: string) => rollbackEdit(id),
	rollbackEditSet: vi.fn(),
}));

/** The ledger arm of a decision the panel also reads through `/readings/decisions`. */
function decisionEntry(id: string, what: string, at: string) {
	return { id, source: 'decision', severity: 'info', actor: 'lab', what, at };
}

const PointInspector = (await import('./PointInspector.svelte')).default;

function reading(index: number, value: number, extra: Record<string, unknown> = {}) {
	return {
		replicate_index: index,
		raw_value: value,
		measurement_type: 'spot',
		is_flagged: false,
		...extra,
	};
}

function response(records: unknown[]) {
	return {
		time: '2026-07-14T09:00:00Z',
		site_id: 'site',
		parameter_id: 'param',
		duplicate_slot: false,
		records,
	};
}

// A hand-entered pH value synced from the portal: one replicate, no correction, no tool run.
function handEntered() {
	return response([
		{
			origin: {
				stream_id: 'stream',
				source_system: 'cnet',
				source_key: 'FP15:pH',
				classification: 'sync',
				ingested_at: '2026-07-15T04:00:00Z',
			},
			readings: [reading(0, 8.005)],
			chain: {},
			computation: { sd_estimator: 'sample', sd_estimator_source: 'default' },
			holds: [],
		},
	]);
}

function open(resp: unknown, props: Record<string, unknown> = {}) {
	getReadingProvenance.mockResolvedValue(resp);
	return render(PointInspector, {
		siteId: 'site',
		parameterId: 'param',
		parameterName: 'pH',
		units: null,
		timeIso: '2026-07-14T09:00:00Z',
		measurementType: 'spot',
		...props,
	});
}

beforeEach(() => vi.clearAllMocks());

describe('PointInspector', () => {
	it('renders a single measurement as a key-value grid rather than a one-row table', async () => {
		const { container } = open(handEntered());
		expect(await screen.findByText('8.005')).toBeTruthy();
		expect(container.querySelector('table')).toBeNull();
		for (const label of ['Measured', 'Corrected', 'Calibration', 'Standard curve', 'State']) {
			expect(screen.getByText(label)).toBeTruthy();
		}
	});

	it('reports when the value on display arrived, not when the row first did', async () => {
		const resp = response([
			{
				origin: {
					stream_id: 'stream',
					source_system: 'cnet',
					source_key: 'FP15:pH',
					classification: 'sync',
					ingested_at: '2026-07-15T04:00:00Z',
					value_arrived_at: '2026-08-02T11:00:00Z',
				},
				readings: [
					reading(0, 8.005, {
						ingested_at: '2026-07-15T04:00:00Z',
						value_arrived_at: '2026-08-02T11:00:00Z',
					}),
				],
				chain: {},
				computation: { sd_estimator: 'sample', sd_estimator_source: 'default' },
				holds: [],
			},
		]);
		const { container } = open(resp);
		await screen.findByText('8.005');
		expect(container.textContent).toContain('2 Aug 2026');
		expect(container.textContent).not.toContain('arrived 15 Jul 2026');
	});

	it('offers Roll back only where the API says the kind can be rolled back', async () => {
		getReadingLedger.mockResolvedValue({
			time: '2026-07-14T09:00:00Z',
			entries: [
				decisionEntry('d1', 'value_correction', '2026-08-02T11:00:00Z'),
				decisionEntry('d2', 'chain', '2026-08-01T11:00:00Z'),
			],
			truncated: false,
		});
		getReadingDecisions.mockResolvedValue([
			{
				id: 'd1',
				stream_id: 'stream',
				time: '2026-07-14T09:00:00Z',
				kind: 'value_correction',
				old: { raw_value: 8.005 },
				new: { raw_value: 11 },
				actor: 'lab',
				at: '2026-08-02T11:00:00Z',
				origin: 'manual',
				reversible: true,
			},
			{
				id: 'd2',
				stream_id: 'stream',
				time: '2026-07-14T09:00:00Z',
				kind: 'chain',
				old: {},
				new: { run_id: 'run-1' },
				actor: 'chain',
				at: '2026-08-01T11:00:00Z',
				origin: 'chain',
				reversible: false,
			},
		]);
		const { container } = open(handEntered());
		await screen.findByText('8.005');
		(await screen.findByText('Show history')).click();
		await screen.findByText('Value corrected');
		expect(screen.getByText('Calculated by a chain run')).toBeTruthy();
		expect(screen.getAllByText('Roll back')).toHaveLength(1);
		// The change itself, which the record held and the panel used not to show.
		expect(container.textContent).toContain('8.005 → 11');
	});

	it('reads one history from every record that holds part of it, filtered by severity', async () => {
		getReadingDecisions.mockResolvedValue([]);
		getReadingLedger.mockImplementation((q: { severity?: string }) => {
			const entries = [
				{
					id: 'job-1',
					source: 'job',
					severity: 'error',
					what: 'reprocess failed',
					at: '2026-08-03T10:00:00Z',
				},
				{
					id: 'hold-1',
					source: 'hold',
					severity: 'warning',
					what: 'replicate_stats (pending)',
					at: '2026-08-02T10:00:00Z',
				},
			].filter((e) => !q.severity || e.severity === q.severity);
			return Promise.resolve({ time: '2026-07-14T09:00:00Z', entries, truncated: false });
		});
		open(handEntered());
		await screen.findByText('8.005');
		(await screen.findByText('Show history')).click();
		expect(await screen.findByText('reprocess failed')).toBeTruthy();
		expect(screen.getByText('replicate_stats (pending)')).toBeTruthy();

		(await screen.findByText('Failures')).click();
		await vi.waitFor(() => expect(screen.queryByText('replicate_stats (pending)')).toBeNull());
		expect(screen.getByText('reprocess failed')).toBeTruthy();
	});

	it('writes an absent value as a plain hyphen and never an em dash', async () => {
		const { container } = open(handEntered());
		await screen.findByText('8.005');
		expect(container.textContent).not.toContain('—');
		expect(screen.getAllByText('-').length).toBeGreaterThan(0);
	});

	it('sets the numbers in right-aligned tabular figures', async () => {
		open(handEntered());
		const cell = (await screen.findByText('8.005')).closest('dd')!;
		expect(cell.className).toContain('text-right');
		expect(cell.className).toContain('tabular-nums');
	});

	it('carries the estimator and no-tool-run explanations as tips rather than paragraphs', async () => {
		open(handEntered());
		await screen.findByText('8.005');
		expect(screen.queryByText(/not declared for this parameter/)).toBeNull();
		expect(screen.queryByText(/Hand-entered measurement, no tool run recorded/)).toBeNull();
		const estimator = screen.getByText('Standard deviation').closest('div')!;
		expect(estimator.getAttribute('title')).toContain('Not declared');
		const computation = screen.getByText('Computation').closest('div')!;
		expect(computation.getAttribute('title')).toContain('no tool run');
	});

	// A continuous value computed by a standalone formula: no run, and the formula version the
	// stored value names.
	function computed(calculation: Record<string, unknown>) {
		return response([
			{
				origin: {
					stream_id: 'stream-d',
					source_system: 'derived',
					source_key: 'pCO2_site',
					classification: 'derived',
					ingested_at: '2026-07-15T04:00:00Z',
				},
				readings: [reading(0, 8.005, { measurement_type: 'derived' })],
				chain: {},
				calculation,
				holds: [],
			},
		]);
	}

	it('names the formula behind a computed value instead of calling it a hand entry', async () => {
		open(
			computed({
				definition_id: 'def-1',
				code: 'pCO2',
				name: 'Partial pressure of CO2',
				version_id: 'v-1',
				version_no: 2,
				formula: 'DIC * 0.5',
				content_hash: 'sha256:abc',
				active_version_no: 3,
			}),
		);
		await screen.findByText('8.005');
		expect(screen.getByText('pCO2 v2, now at v3')).toBeTruthy();
		const computation = screen.getByText('Computation').closest('div')!;
		expect(computation.getAttribute('title')).toContain('DIC * 0.5');
		expect(computation.getAttribute('title')).not.toContain('Hand-entered');
	});

	it('says the formula is not recoverable for a value stored before versioning', async () => {
		open(
			computed({
				definition_id: 'def-1',
				code: 'pCO2',
				name: 'Partial pressure of CO2',
				active_version_no: 1,
			}),
		);
		await screen.findByText('8.005');
		expect(screen.getByText('pCO2, formula not recoverable')).toBeTruthy();
	});

	it('offers its actions as one row of links', async () => {
		open(handEntered(), { onflag: () => {} });
		await screen.findByText('8.005');
		const actions = screen.getByRole('group', { name: 'Actions' });
		const labels = Array.from(actions.children).map((c) => (c.textContent ?? '').trim());
		expect(labels).toContain('Flag replicates');
		expect(labels).toContain('Open stream');
	});

	it('keeps the table for a replicate group', async () => {
		const resp = handEntered() as ReturnType<typeof handEntered>;
		(resp.records[0] as { readings: unknown[] }).readings = [reading(0, 8.005), reading(1, 8.117)];
		const { container } = open(resp);
		await screen.findByText('8.005');
		expect(container.querySelector('table')).not.toBeNull();
	});

	// A synced three-replicate group with one withdrawn replicate, a windowed calibration and a
	// hand-picked standard curve, a covering reconciliation pass, a deployed instrument and a hold.
	function syncedGroup() {
		return response([
			{
				origin: {
					stream_id: 'stream-7',
					source_system: 'cnet',
					source_key: 'FP15:DOC_avg_ppb:reps',
					source_name: 'DOC replicates',
					classification: 'sync',
					paired_at: '2026-05-02T10:00:00Z',
					ingested_at: '2026-07-15T04:00:00Z',
					receipt: {
						id: 'receipt-1',
						at: '2026-07-15T04:00:00Z',
						window_from: '2026-07-01T00:00:00Z',
						window_to: '2026-07-31T00:00:00Z',
						submitted: 42,
						new_rows: 3,
						changed: 1,
						unchanged: 37,
						withdrawn: 1,
						rejected_total: 1,
						braked: false,
					},
				},
				readings: [
					reading(0, 41.2, {
						calibrated_value: 42.1,
						ingested_at: '2026-07-10T04:00:00Z',
						calibration: {
							id: 'cal-1',
							slope: 1.043,
							intercept: -0.12,
							valid_from: '2026-01-01T00:00:00Z',
							valid_until: '2026-12-31T00:00:00Z',
						},
						standard_curve: { id: 'curve-9', sensor_id: 'lab-3', name: 'Plate 7', slope: 2, intercept: 1 },
					}),
					reading(1, 41.4, { ingested_at: '2026-07-10T04:00:00Z' }),
					reading(2, 62, {
						withdrawn_at: '2026-07-15T04:00:00Z',
						withdrawn_reason: 'absent from source window',
						ingested_at: '2026-07-10T04:00:00Z',
					}),
				],
				chain: {
					sensor: { id: 'sensor-1', serial_number: '25284027', manufacturer: 'Vaisala', model: 'HMP' },
					deployment: {
						id: 'dep-1',
						site_id: 'site',
						site_name: 'Martigny',
						deployed_from: '2026-01-01T00:00:00Z',
						deployed_until: '2026-08-01T00:00:00Z',
					},
				},
				computation: { sd_estimator: 'sample', sd_estimator_source: 'slot', created_by: 'evan' },
				holds: [{ id: 'hold-5', kind: 'replicate_stats', status: 'pending', created_at: '2026-07-15T05:00:00Z' }],
			},
		]);
	}

	describe('renders what the record serves', () => {
		it('prints the withdrawal reason beside the withdrawn state', async () => {
			open(syncedGroup());
			await screen.findByText('41.2');
			expect(screen.getByText(/absent from source window/)).toBeTruthy();
		});

		it('prints the calibration window and the curve name as visible text', async () => {
			const { container } = open(syncedGroup());
			await screen.findByText('41.2');
			expect(screen.getByText('Plate 7')).toBeTruthy();
			expect(container.textContent).toContain(`valid ${formatDateTime('2026-01-01T00:00:00Z')} to ${formatDateTime('2026-12-31T00:00:00Z')}`);
		});

		it('prints the receipt as its counters and window bounds', async () => {
			const { container } = open(syncedGroup());
			await screen.findByText('41.2');
			const text = container.textContent ?? '';
			for (const part of ['42 submitted', '3 new', '1 changed', '37 unchanged', '1 withdrawn', '1 rejected']) {
				expect(text).toContain(part);
			}
			expect(text).toContain(formatDateTime('2026-07-01T00:00:00Z'));
		});

		it('tags the record with its cadence, source name, pairing date, instrument window and author', async () => {
			const { container } = open(syncedGroup());
			await screen.findByText('41.2');
			const text = container.textContent ?? '';
			expect(screen.getByText('spot')).toBeTruthy();
			expect(text).toContain('DOC replicates');
			expect(text).toContain(`paired ${formatDateTime('2026-05-02T10:00:00Z')}`);
			expect(text).toMatch(/25284027/);
			expect(text).toContain(formatDateTime('2026-08-01T00:00:00Z'));
			expect(text).toContain('evan');
		});
	});

	describe('links each curve to its record', () => {
		it('wraps the calibration equation in a link to the calibration', async () => {
			const { container } = open(syncedGroup());
			await screen.findByText('41.2');
			const cal = container.querySelector('a[href="/admin/sensors/sensor-1?tab=calibrations&cal=cal-1"]');
			expect(cal).not.toBeNull();
			expect(cal!.textContent).toContain('1.043');
		});

		it('links the standard curve to the instrument that owns it', async () => {
			const { container } = open(syncedGroup());
			await screen.findByText('41.2');
			const curve = container.querySelector('a[href="/admin/sensors/lab-3?tab=curves&curve=curve-9"]');
			expect(curve).not.toBeNull();
			expect(curve!.textContent).toContain('Plate 7');
		});
	});

	it('links a hold to the queue narrowed to that stream and hold', async () => {
		const { container } = open(syncedGroup());
		await screen.findByText('41.2');
		const link = container.querySelector('a[href*="tab=audits"]')!;
		expect(link.getAttribute('href')).toContain('holds_streams=stream-7');
		expect(link.getAttribute('href')).toContain('holds_id=hold-5');
	});

	describe('opened from a visit', () => {
		it('renders a preloaded record without fetching', async () => {
			render(PointInspector, {
				siteId: 'site',
				parameterId: 'param',
				parameterName: 'DOC',
				timeIso: '2026-07-14T09:00:00Z',
				measurementType: 'spot',
				preloaded: syncedGroup() as unknown as ProvenanceResponse,
			});
			expect(await screen.findByText('41.2')).toBeTruthy();
			expect(getReadingProvenance).not.toHaveBeenCalled();
		});

		it('offers the flag action and hands over the replicates the record holds', async () => {
			const onflag = vi.fn();
			render(PointInspector, {
				siteId: 'site',
				parameterId: 'param',
				parameterName: 'DOC',
				timeIso: '2026-07-14T09:00:00Z',
				measurementType: 'spot',
				preloaded: syncedGroup() as unknown as ProvenanceResponse,
				onflag,
			});
			await screen.findByText('41.2');
			(screen.getByText('Flag replicates') as HTMLButtonElement).click();
			expect(onflag).toHaveBeenCalledTimes(1);
			const reps = onflag.mock.calls[0][0];
			expect(reps.map((r: { replicate_index: number }) => r.replicate_index)).toEqual([0, 1, 2]);
			expect(reps[0].standard_curve_id).toBe('curve-9');
			expect(reps[2].withdrawn).toBe(true);
		});

		it('re-reads the record and tells the visit after a roll-back, instead of redrawing what it was handed', async () => {
			getReadingLedger.mockResolvedValue({
				time: '2026-07-14T09:00:00Z',
				entries: [decisionEntry('d1', 'value_correction', '2026-08-02T11:00:00Z')],
				truncated: false,
			});
			getReadingDecisions.mockResolvedValue([
				{
					id: 'd1',
					stream_id: 'stream',
					time: '2026-07-14T09:00:00Z',
					kind: 'value_correction',
					old: { raw_value: 8.005 },
					new: { raw_value: 11 },
					actor: 'lab',
					at: '2026-08-02T11:00:00Z',
					origin: 'manual',
					reversible: true,
				},
			]);
			getReadingProvenance.mockResolvedValue(handEntered());
			const onchange = vi.fn();
			render(PointInspector, {
				siteId: 'site',
				parameterId: 'param',
				parameterName: 'pH',
				timeIso: '2026-07-14T09:00:00Z',
				measurementType: 'spot',
				preloaded: response([
					{
						origin: {
							stream_id: 'stream',
							source_system: 'cnet',
							source_key: 'FP15:pH',
							classification: 'manual',
							ingested_at: '2026-07-15T04:00:00Z',
						},
						readings: [reading(0, 11)],
						chain: {},
						computation: { sd_estimator: 'sample', sd_estimator_source: 'default' },
						holds: [],
					},
				]) as unknown as ProvenanceResponse,
				onchange,
			});

			await screen.findByText('11');
			expect(getReadingProvenance).not.toHaveBeenCalled();
			(await screen.findByText('Show history')).click();
			(await screen.findByText('Roll back')).click();

			await waitFor(() => expect(onchange).toHaveBeenCalledTimes(1));
			expect(rollbackEdit).toHaveBeenCalledWith('d1');
			expect(getReadingProvenance).toHaveBeenCalledTimes(1);
			expect(await screen.findByText('8.005')).toBeTruthy();
		});

		it('says when the instant carries no readings rather than fetching', async () => {
			render(PointInspector, {
				siteId: 'site',
				parameterId: 'param',
				parameterName: 'DOC',
				timeIso: '2026-07-14T09:00:00Z',
				measurementType: 'spot',
				preloaded: response([]) as unknown as ProvenanceResponse,
			});
			expect(await screen.findByText(/No readings at this instant/)).toBeTruthy();
			expect(getReadingProvenance).not.toHaveBeenCalled();
		});
	});

	it('copies the link it was given', async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		open(handEntered(), { link: 'https://river.test/admin/sites/site?point=sp&t=2026-07-14T09:00:00.000Z&mt=spot' });
		await screen.findByText('8.005');
		(screen.getByText('Copy link') as HTMLButtonElement).click();
		expect(writeText).toHaveBeenCalledWith(
			'https://river.test/admin/sites/site?point=sp&t=2026-07-14T09:00:00.000Z&mt=spot',
		);
	});
});
