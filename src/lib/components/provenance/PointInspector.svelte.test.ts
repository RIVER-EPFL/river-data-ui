import { render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProvenanceResponse } from '$api/service';
import { formatDateTime } from '$lib/utils';

const getReadingProvenance = vi.fn();
const getReadingLedger = vi.fn();
/** The decision rows the API carries on the ledger's decision entries, matched by id. */
let decisionRows: Array<{ id: string } & Record<string, unknown>> = [];
const rollbackEdit = vi.fn();
const rollbackEditSet = vi.fn();
const getEditSet = vi.fn();
const reopenReplicateAudit = vi.fn();
vi.mock('$api/service', () => ({
	getReadingProvenance: (q: unknown) => getReadingProvenance(q),
	getReadingLedger: async (q: unknown) => carried(await getReadingLedger(q)),
	rollbackEdit: (id: string) => rollbackEdit(id),
	rollbackEditSet: (id: string) => rollbackEditSet(id),
	getEditSet: (id: string) => getEditSet(id),
	reopenReplicateAudit: (id: string) => reopenReplicateAudit(id),
}));

/** The ledger arm of a decision; its row rides on it from `decisionRows`. */
function decisionEntry(id: string, what: string, at: string) {
	return { id, source: 'decision', severity: 'info', actor: 'lab', what, at };
}

function carried(ledger: { entries: { id: string; source: string }[] }) {
	return {
		...ledger,
		entries: ledger.entries.map((e) =>
			e.source === 'decision' ? { ...e, decision: decisionRows.find((d) => d.id === e.id) } : e,
		),
	};
}

const admin = { value: false };
vi.mock('$auth/me.svelte', () => ({
	me: { can: (cap: string) => cap !== 'admin' || admin.value },
}));

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
			computation: {},
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

beforeEach(() => {
	vi.clearAllMocks();
	admin.value = false;
	decisionRows = [];
	getReadingLedger.mockResolvedValue({ time: '2026-07-14T09:00:00Z', entries: [], truncated: false });
});

// A calculated value: one replicate a tool run produced, with the override the record may carry.
function calculated(overridden?: Record<string, unknown>) {
	return response([
		{
			origin: {
				stream_id: 'stream',
				source_system: 'grab_sample',
				source_key: 'site:pCO2',
				classification: 'manual',
			},
			readings: [reading(0, 340, overridden ? { overridden } : {})],
			chain: {},
			computation: { provenance: { run_id: 'run-1' }, run_source: 'chain' },
			holds: [],
		},
	]);
}

describe('PointInspector', () => {
	// Scenario: an administrator replaced a computed pCO2 by hand.
	// Expected behaviour: the record says so beside the value, naming the computed value it
	// replaced, who replaced it and why, and offers no second override.
	it('says a value was overridden by hand, and what the calculation gave', async () => {
		admin.value = true;
		open(
			calculated({
				computed_value: 331.9,
				by: 'admin',
				at: '2026-07-15T08:00:00Z',
				reason: 'field log',
			}),
		);
		const line = await screen.findByTestId('overridden');
		expect(line.textContent).toContain('Overridden by hand by admin');
		expect(line.textContent).toContain('the calculation gave 331.9');
		expect(line.textContent).toContain('field log');
		expect(screen.queryByRole('button', { name: 'Override' })).toBeNull();
	});

	it('offers an administrator the override of a calculated value, and nobody else', async () => {
		admin.value = true;
		const { unmount } = open(calculated());
		expect(await screen.findByRole('button', { name: 'Override' })).toBeTruthy();
		unmount();
		admin.value = false;
		open(calculated());
		await screen.findByText('Edit');
		expect(screen.queryByRole('button', { name: 'Override' })).toBeNull();
	});

	it('renders a single measurement as a key-value grid rather than a one-row table', async () => {
		const { container } = open(handEntered());
		expect(await screen.findByText('8.005')).toBeTruthy();
		expect(container.querySelector('table')).toBeNull();
		expect(screen.getByText('Measured')).toBeTruthy();
	});

	// Every row the record can print reads `-` for this measurement, and a screen of hyphens is
	// what buried the value.
	it('leaves out a row the record has no value for', async () => {
		open(handEntered());
		await screen.findByText('8.005');
		for (const label of ['Corrected', 'Calibration', 'Standard curve', 'State', 'Instrument']) {
			expect(screen.queryByText(label)).toBeNull();
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
				computation: {},
				holds: [],
			},
		]);
		const { container } = open(resp);
		await screen.findByText('8.005');
		expect(container.textContent).toContain(formatDateTime('2026-08-02T11:00:00Z'));
		expect(container.textContent).not.toContain(formatDateTime('2026-07-15T04:00:00Z'));
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
		decisionRows = ([
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
		await screen.findByText('Value corrected');
		expect(screen.getByText('Calculated by a chain run')).toBeTruthy();
		expect(screen.getAllByRole('button', { name: 'Roll back this reading' })).toHaveLength(1);
		// The change itself, which the record held and the panel used not to show.
		expect(container.textContent).toContain('8.005 → 11');
	});

	it('rolls back this reading or the whole edit, each after naming what it puts back', async () => {
		getReadingLedger.mockResolvedValue({
			time: '2026-07-14T09:00:00Z',
			entries: [decisionEntry('d1', 'value_correction', '2026-08-02T11:00:00Z')],
			truncated: false,
		});
		const corrected = (id: string, stream: string, from: number, to: number) => ({
			id,
			stream_id: stream,
			time: '2026-07-14T09:00:00Z',
			replicate_index: 0,
			kind: 'value_correction',
			old: { raw_value: from },
			new: { raw_value: to },
			actor: 'lab',
			at: '2026-08-02T11:00:00Z',
			origin: 'manual',
			reversible: true,
			rolled_back_by: null,
			set_id: 'set-1',
		});
		// One member here: the switch that picked the endpoint by the local member count would have
		// rolled back this reading alone, leaving the edit's other stream as it was.
		decisionRows = ([corrected('d1', 'stream', 8.005, 11)]);
		getEditSet.mockResolvedValue({
			set_id: 'set-1',
			members: [
				{ decision: corrected('d1', 'stream', 8.005, 11), parameter_code: 'pH', parameter_name: 'pH' },
				{ decision: corrected('d2', 'other', 20, 25), parameter_code: 'temp', parameter_name: 'Temperature' },
			],
		});
		rollbackEditSet.mockResolvedValue({ set_id: 'set-1', rolled_back: 2 });
		open(handEntered());
		await screen.findByText('8.005');
		expect(await screen.findByRole('button', { name: 'Roll back this reading' })).toBeTruthy();
		(await screen.findByRole('button', { name: 'Roll back the whole edit' })).click();

		const dialog = await screen.findByRole('dialog');
		await waitFor(() => expect(dialog.textContent).toContain('temp replicate 0: Measured 25 → 20'));
		expect(dialog.textContent).toContain('pH replicate 0: Measured 11 → 8.005');
		expect(getEditSet).toHaveBeenCalledWith('set-1');
		expect(rollbackEditSet).not.toHaveBeenCalled();
		(await screen.findByRole('button', { name: 'Roll back' })).click();
		await waitFor(() => expect(rollbackEditSet).toHaveBeenCalledWith('set-1'));
		expect(rollbackEdit).not.toHaveBeenCalled();
	});

	it('offers the ruling reopen in place of Roll back for a standing ruling', async () => {
		getReadingLedger.mockResolvedValue({
			time: '2026-07-14T09:00:00Z',
			entries: [decisionEntry('v0', 'verify', '2026-08-02T11:00:00Z')],
			truncated: false,
		});
		const verify = (id: string, index: number) => ({
			id,
			stream_id: 'stream',
			time: '2026-07-14T09:00:00Z',
			replicate_index: index,
			kind: 'verify',
			old: { unverified: true },
			new: { unverified: false },
			actor: 'manager',
			at: '2026-08-02T11:00:00Z',
			origin: 'audit',
			reversible: true,
			set_id: 'set-1',
			ruling_hold_id: 'hold-1',
		});
		decisionRows = ([verify('v0', 0), verify('v1', 1)]);
		reopenReplicateAudit.mockResolvedValue({ status: 'pending' });
		open(handEntered());
		await screen.findByText('8.005');
		await screen.findByText('Entry verified');
		expect(screen.queryByRole('button', { name: 'Roll back this reading' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Roll back the whole edit' })).toBeNull();
		(await screen.findByText('Reopen ruling')).click();
		await waitFor(() => expect(reopenReplicateAudit).toHaveBeenCalledWith('hold-1'));
		expect(rollbackEdit).not.toHaveBeenCalled();
		expect(rollbackEditSet).not.toHaveBeenCalled();
	});

	it('reads one history from every record that holds part of it, filtered by severity', async () => {
		decisionRows = ([]);
		getReadingLedger.mockImplementation((q: { severity?: string }) => {
			const entries = [
				{
					id: 'job-1',
					source: 'job',
					severity: 'error',
					what: 'manual_reprocess failed: the pool timed out',
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
		expect(await screen.findByText('Manual reprocess failed: the pool timed out')).toBeTruthy();
		const held = 'Statistics disagreement raised, waiting for a ruling';
		expect(screen.getByText(held)).toBeTruthy();

		(await screen.findByText('Failures')).click();
		await vi.waitFor(() => expect(screen.queryByText(held)).toBeNull());
		expect(screen.getByText('Manual reprocess failed: the pool timed out')).toBeTruthy();
	});

	// Scenario: a value whose history is a correction, a recompute that moved nothing and two
	// catalogue inserts. Expected behaviour: no arm code reaches the screen, every entry is a row
	// of one table in date order, and nothing is folded away under Administrative.
	it('lists every dated entry as one table, newest first', async () => {
		decisionRows = ([
			{
				id: 'd1',
				stream_id: 'stream',
				time: '2026-07-14T09:00:00Z',
				kind: 'value_correction',
				old: { raw_value: 8.005 },
				new: { raw_value: 8.11 },
				actor: 'lab',
				at: '2026-08-02T11:00:00Z',
				origin: 'manual',
				reversible: true,
			},
		]);
		getReadingLedger.mockResolvedValue({
			time: '2026-07-14T09:00:00Z',
			entries: [
				decisionEntry('d1', 'value_correction', '2026-08-02T11:00:00Z'),
				{
					id: 'job-1',
					source: 'job',
					severity: 'info',
					what: 'event_recompute completed',
					at: '2026-08-01T10:00:00Z',
					new: { readings_updated: 0 },
				},
				{
					id: 'c1',
					source: 'change',
					severity: 'info',
					actor: 'admin@local.dev',
					what: 'site_parameter_insert',
					at: '2026-07-10T10:00:00Z',
				},
				{
					id: 'c2',
					source: 'change',
					severity: 'info',
					actor: 'admin@local.dev',
					what: 'parameter_insert',
					at: '2026-07-09T10:00:00Z',
				},
			],
			truncated: false,
		});
		const { container } = open(handEntered());
		await screen.findByText('8.005');
		await screen.findByText('Value corrected');

		const history = screen.getByRole('region', { name: 'History' });
		const text = history.textContent ?? '';
		expect(text).not.toContain('site_parameter_insert');
		expect(text).not.toContain('parameter_insert');
		expect(text).not.toContain('event_recompute');
		expect(text).not.toContain('Administrative');
		const rows = Array.from(history.querySelectorAll('tbody tr')).map((r) => r.textContent ?? '');
		expect(rows).toHaveLength(4);
		expect(rows[0]).toContain('Value corrected');
		expect(rows[0]).toContain('8.005 → 8.11');
		expect(rows[1]).toContain('Visit recompute completed');
		expect(rows[2]).toContain('Parameter added at this site');
		expect(rows[3]).toContain('Parameter added to the catalogue');
		expect(history.querySelectorAll('[data-testid="history-axis"] span[title]')).toHaveLength(4);
		expect(container.textContent).not.toContain('show all');
	});

	it('opens a job entry on the job it names, and a tag entry on the discrepancies at this reading', async () => {
		decisionRows = ([]);
		getReadingLedger.mockResolvedValue({
			time: '2026-07-14T09:00:00Z',
			entries: [
				{ id: 'job-1', source: 'job', severity: 'info', what: 'event_recompute completed', at: '2026-08-03T10:00:00Z' },
				{ id: 'job-1', source: 'job_log', severity: 'warning', what: 'step skipped', at: '2026-08-03T10:01:00Z' },
				{ id: 'hold-5', source: 'hold', severity: 'warning', what: 'replicate_stats (pending)', at: '2026-08-02T10:00:00Z' },
			],
			truncated: false,
		});
		const { container } = open(syncedGroup());
		await screen.findAllByText('41.2');
		await screen.findByText('Visit recompute completed');
		const hrefs = Array.from(container.querySelectorAll('tr a')).map((a) => a.getAttribute('href'));
		expect(hrefs.filter((h) => h === '/admin/system?tab=jobs&job=job-1')).toHaveLength(2);
		expect(hrefs.some((h) => h?.includes('review=discrepancies') && h.includes('tags_kind=replicate_stats'))).toBe(true);
	});

	it('writes an absent value as a plain hyphen and never an em dash', async () => {
		const { container } = open(syncedGroup());
		await screen.findAllByText('41.2');
		expect(container.textContent).not.toContain('—');
		expect(screen.getAllByText('-').length).toBeGreaterThan(0);
	});

	it('sets the numbers in tabular figures under their label', async () => {
		open(handEntered());
		const cell = (await screen.findByText('8.005')).closest('dd')!;
		expect(cell.className).toContain('tabular-nums');
		expect(cell.previousElementSibling?.tagName).toBe('DT');
	});

	it('names the sample formula as a tip on the standard deviation rather than a paragraph', async () => {
		open(syncedGroup());
		await screen.findAllByText('41.2');
		const sd = screen.getByText('Standard deviation').closest('div')!;
		expect(sd.getAttribute('title')).toContain('sample standard deviation (n-1)');
	});

	// A continuous value computed by a standalone formula: no run, and the formula version the
	// stored value names.
	function computed(
		calculation: Record<string, unknown>,
		consumed?: unknown[],
		captured_by?: Record<string, unknown>,
	) {
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
				consumed,
				captured_by,
				holds: [],
			},
		]);
	}

	const formula = {
		definition_id: 'def-1',
		code: 'pCO2',
		name: 'Partial pressure of CO2',
		version_id: 'v-1',
		version_no: 2,
		formula: 'DIC * 0.5',
		content_hash: 'sha256:abc',
		active_version_no: 2,
	};

	function consumedReading(state: string, extra: Record<string, unknown> = {}) {
		return {
			variable: 'DIC',
			kind: 'reading',
			revision: 4,
			current_revision: state === 'changed' ? 5 : 4,
			value: 16.01,
			current_value: state === 'changed' ? 17.2 : 16.01,
			state,
			members: [
				{
					stream_id: 'stream-dic',
					time: '2026-07-14T09:00:00Z',
					replicate_index: 0,
					revision: 4,
					value: 16.01,
					current_revision: state === 'changed' ? 5 : 4,
					current_value: state === 'changed' ? 17.2 : 16.01,
					state,
					point: {
						site_id: 'site',
						site_parameter_id: 'sp-dic',
						time: '2026-07-14T09:00:00Z',
						measurement_type: 'spot',
					},
					...extra,
				},
			],
		};
	}

	it('opens the reading a computed value was read from', async () => {
		open(computed(formula, [consumedReading('unchanged')]));
		await screen.findByText('8.005');
		const link = screen.getByText('DIC').closest('a')!;
		expect(link.getAttribute('href')).toContain('/sites/site?point=sp-dic');
		expect(link.getAttribute('href')).toContain('mt=spot');
	});

	it('marks an input whose source has moved, beside what it holds now', async () => {
		const { container } = open(computed(formula, [consumedReading('changed')]));
		await screen.findByText('8.005');
		expect(screen.getByText('changed')).toBeTruthy();
		expect(screen.getByText('a source has moved')).toBeTruthy();
		// What was read and what the key holds now are both on the row.
		const text = container.textContent ?? '';
		expect(text).toContain('16.01');
		expect(text).toContain('17.2');
	});

	it('names the recompute behind the inputs it shows and opens its run', async () => {
		open(
			computed(formula, [consumedReading('changed')], {
				id: 'decision-1',
				seq: 289,
				kind: 'formula_transition',
				job_id: 'job-7',
			}),
		);
		await screen.findByText('8.005');
		const link = screen.getByText('Recomputed under a new formula version, ledger entry 289').closest('a')!;
		expect(link.getAttribute('href')).toContain('/system?tab=jobs&job=job-7');
	});

	it('names a key with no slot without offering a link to it', async () => {
		open(computed(formula, [consumedReading('unchanged', { point: undefined })]));
		await screen.findByText('8.005');
		expect(screen.getByText('DIC').closest('a')).toBeNull();
	});

	// Scenario: a pCO2 average the portal computed with calcPCO2, synced with the declaration on
	// its stream, at a visit that holds one of the columns it read.
	// Expected behaviour: the record names the function and opens the held column's record.
	it('names the portal function a synced column was computed by, opening the inputs it holds', async () => {
		open(
			response([
				{
					origin: {
						stream_id: 'stream',
						source_system: 'cnet',
						source_key: 'FP15:CO2_HS_Um_avg',
						classification: 'sync',
						portal_calculation: {
							function: 'calcPCO2',
							inputs: [
								{
									column: 'lab_co2_co2ppm',
									point: {
										site_id: 'site',
										site_parameter_id: 'sp-co2',
										time: '2026-07-14T09:00:00Z',
										measurement_type: 'spot',
									},
								},
								{ column: 'Field_BP' },
							],
						},
					},
					readings: [reading(0, 8.005)],
					chain: {},
					computation: {},
					holds: [],
				},
			]),
		);
		await screen.findByText('8.005');
		expect(screen.getByText('calcPCO2')).toBeTruthy();
		const held = screen.getByText('lab_co2_co2ppm').closest('a')!;
		expect(held.getAttribute('href')).toContain('/sites/site?point=sp-co2');
		expect(screen.getByText('Field_BP').closest('a')).toBeNull();
	});

	it('names no portal function for a column the portal stores as entered', async () => {
		open(handEntered());
		await screen.findByText('8.005');
		expect(screen.queryByText('Portal calculation')).toBeNull();
	});

	it('says the inputs are unknown for a computed value that recorded none', async () => {
		const { container } = open(computed(formula));
		await screen.findByText('8.005');
		expect(container.textContent).toContain('Consumed inputs unknown');
	});

	it('claims nothing about the inputs of a value nothing computed', async () => {
		const { container } = open(handEntered());
		await screen.findByText('8.005');
		expect(container.textContent).not.toContain('Consumed');
	});

	it('leads a computed value with the formula that produced it', async () => {
		const { container } = open(
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
		const text = container.textContent ?? '';
		expect(text.indexOf('pCO2 v2, now at v3')).toBeLessThan(text.indexOf('Computed'));
		// A value the calculation produced is not called measured (B659).
		expect(text).not.toContain('Measured');
	});

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

	it('opens the formula behind a computed value from its computation line', async () => {
		open(
			computed({
				definition_id: 'def-1',
				tool_script_id: 'ts-1',
				code: 'pCO2',
				name: 'Partial pressure of CO2',
				version_no: 2,
				active_version_no: 2,
			}),
		);
		const link = await screen.findByRole('link', { name: 'pCO2 v2' });
		expect(link.getAttribute('href')).toContain('/toolbox/ts-1');
	});

	it('opens the calculation a formula belongs to rather than the formula', async () => {
		open(
			computed({
				definition_id: 'def-1',
				tool_script_id: 'ts-1',
				code: 'pCO2',
				name: 'Partial pressure of CO2',
				version_no: 2,
				active_version_no: 2,
			}),
		);
		const owned = await screen.findByRole('link', { name: 'pCO2 v2' });
		expect(owned.getAttribute('href')).toContain('/toolbox/ts-1');
	});

	it('says the calculation behind a value was decommissioned, and keeps the link to it', async () => {
		open(
			computed({
				...formula,
				tool_script_id: 'ts-1',
				decommissioned: { at: '2026-09-23T10:00:00Z', by: 'evan', reason: 'replaced by pco2_v2' },
			}),
		);
		const link = await screen.findByRole('link', { name: 'pCO2 v2' });
		expect(link.getAttribute('href')).toContain('/toolbox/ts-1');
		expect(screen.getByText(/^Calculation decommissioned on .* by evan: replaced by pco2_v2$/)).toBeTruthy();
	});

	it('says nothing of a decommission while the calculation is live', async () => {
		open(computed({ ...formula, tool_script_id: 'ts-1' }));
		await screen.findByRole('link', { name: 'pCO2 v2' });
		expect(screen.queryByText(/decommissioned/)).toBeNull();
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

	it('opens the visit on the parameter the reading is of', async () => {
		const resp = handEntered() as ReturnType<typeof handEntered>;
		Object.assign(resp.records[0] as Record<string, unknown>, {
			event: { id: 'visit', collected_at: '2026-07-14T09:00:00Z', source: 'manual', created_by: 'lab' },
		});
		open(resp);
		const link = await screen.findByRole('link', { name: 'Open visit' });
		expect(link.getAttribute('href')).toMatch(/\/sites\/site\?tab=visits&event=visit&parameter=param$/);
	});

	it('links a synced origin to its sync service for an admin only', async () => {
		admin.value = true;
		const first = open(handEntered());
		await screen.findByText('8.005');
		const link = first.container.querySelector('a[href$="/streams?tab=services&service=cnet"]');
		expect(link).toBeTruthy();
		first.unmount();
		admin.value = false;
		const second = open(handEntered());
		await screen.findByText('8.005');
		expect(second.container.querySelector('a[href*="service="]')).toBeNull();
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
				computation: {
					created_by: 'evan',
					n: 2,
					mean: 41.3,
					stdev: 0.1414,
					min: 41.2,
					max: 41.4,
				},
				holds: [{ id: 'hold-5', kind: 'replicate_stats', status: 'pending', created_at: '2026-07-15T05:00:00Z' }],
			},
		]);
	}

	describe('renders what the record serves', () => {
		it('prints the withdrawal reason beside the withdrawn state', async () => {
			open(syncedGroup());
			await screen.findAllByText('41.2');
			expect(screen.getByText(/absent from source window/)).toBeTruthy();
		});

		// The state is written by the grid's own save path and excluded from every statistic, so
		// the record is where a manager finds out that is why the sample counts nothing.
		it('names a pending entry as pending rather than leaving its state blank', async () => {
			open(
				response([
					{
						origin: {
							stream_id: 'stream',
							source_system: 'grab_sample',
							source_key: 'FP15:pH',
							classification: 'manual',
							ingested_at: '2026-07-15T04:00:00Z',
						},
						readings: [reading(0, 8.005, { unverified: true }), reading(1, 8.02, { unverified: true })],
						chain: {},
						computation: {},
						holds: [],
					},
				]),
			);
			await screen.findByText('8.005');
			expect(screen.getAllByText('pending')).toHaveLength(2);
		});

		it('prints the calibration window and the curve name as visible text', async () => {
			const { container } = open(syncedGroup());
			await screen.findAllByText('41.2');
			expect(screen.getByText('Plate 7')).toBeTruthy();
			expect(container.textContent).toContain(`valid ${formatDateTime('2026-01-01T00:00:00Z')} to ${formatDateTime('2026-12-31T00:00:00Z')}`);
		});

		it('prints the receipt as its counters and window bounds', async () => {
			const { container } = open(syncedGroup());
			await screen.findAllByText('41.2');
			const text = container.textContent ?? '';
			for (const part of ['42 submitted', '3 new', '1 changed', '37 unchanged', '1 withdrawn', '1 rejected']) {
				expect(text).toContain(part);
			}
			expect(text).toContain(formatDateTime('2026-07-01T00:00:00Z'));
		});

		it('tags the record with its cadence, source name, instrument window and author', async () => {
			const { container } = open(syncedGroup());
			await screen.findAllByText('41.2');
			const text = container.textContent ?? '';
			expect(screen.getByText('spot')).toBeTruthy();
			expect(text).toContain('DOC replicates');
			expect(text).toMatch(/25284027/);
			expect(text).toContain(formatDateTime('2026-08-01T00:00:00Z'));
			expect(text).toContain('evan');
		});

		it('prints the label and notes the save named beside the author', async () => {
			const resp = syncedGroup();
			const rec = resp.records[0] as { computation: Record<string, unknown> };
			rec.computation = { ...rec.computation, label: 'field campaign', notes: 'filter clogged on rep 2' };
			const { container } = open(resp);
			await screen.findAllByText('41.2');
			const text = container.textContent ?? '';
			expect(screen.getByText('Label')).toBeTruthy();
			expect(text).toContain('field campaign');
			expect(screen.getByText('Notes')).toBeTruthy();
			expect(text).toContain('filter clogged on rep 2');
		});

		it('prints no label or notes line when the save named neither', async () => {
			open(syncedGroup());
			await screen.findAllByText('41.2');
			expect(screen.queryByText('Label')).toBeNull();
			expect(screen.queryByText('Notes')).toBeNull();
		});

		// What a scientist opens the record for: the replicates, then what they compute to. The
		// arrival and pairing stamps are administrative and follow.
		it('leads with the replicates and their statistics, before any metadata row', async () => {
			const { container } = open(syncedGroup());
			await screen.findAllByText('41.2');
			const text = container.textContent ?? '';
			for (const value of ['41.2', '41.4', '62', '0.1414', '41.3']) {
				expect(text).toContain(value);
			}
			expect(text.indexOf('0.1414')).toBeLessThan(text.indexOf('Instrument'));
			expect(text.indexOf('41.2')).toBeLessThan(text.indexOf('Administrative'));
		});

		// Scenario: a scientist clicks a spot point under a chart.
		//
		// Expected behaviour: the strip they land on is the value, the statistics, the instrument
		// and the computation, and everything that explains where the row came from is one
		// disclosure below it.
		it('leads with a summary strip and puts the rest behind one closed disclosure', async () => {
			const { container } = open(syncedGroup());
			await screen.findAllByText('41.2');
			const details = container.querySelectorAll('details');
			expect(details).toHaveLength(1);
			expect(details[0].open).toBe(false);

			const strip = container.textContent!.slice(0, container.textContent!.indexOf('Details'));
			for (const led of ['Replicates', 'Mean', 'Standard deviation', 'Instrument', 'Run by']) {
				expect(strip).toContain(led);
			}
			expect(strip).not.toContain('Administrative');
			expect(details[0].querySelector('table')).not.toBeNull();
			expect(details[0].textContent).toContain('Administrative');
			// The history is not behind the disclosure: it is open beside the record (Q313).
			const history = screen.getByRole('region', { name: 'History' });
			expect(details[0].contains(history)).toBe(false);
		});

		it('lays the statistics out as labelled fields on one grid', async () => {
			const { container } = open(syncedGroup());
			await screen.findAllByText('41.2');
			const line = screen.getByText('Standard deviation').closest('.grid')!;
			expect(line).not.toBeNull();
			expect(line.textContent).toContain('Replicates');
			expect(line.textContent).toContain('41.4');
		});

		// One curve made every replicate, so the per-replicate column would repeat it three times.
		it('carries a shared calibration on the strip and drops the table column that repeats it', async () => {
			const resp = syncedGroup();
			const readings = (resp.records[0] as { readings: Record<string, unknown>[] }).readings;
			const applied = { calibration: readings[0].calibration, standard_curve: readings[0].standard_curve };
			for (const r of readings) Object.assign(r, applied);
			const { container } = open(resp);
			await screen.findAllByText('41.2');
			expect(screen.getAllByText('Plate 7')).toHaveLength(1);
			expect(container.querySelector('thead')!.textContent).not.toContain('Applied');
		});

		it('bounds the panel so unfolding the details scrolls inside it', async () => {
			const { container } = open(syncedGroup());
			await screen.findAllByText('41.2');
			const panel = container.querySelector('div')!;
			expect(panel.className).toContain('max-h-[70vh]');
			expect(panel.querySelector('.overflow-y-auto')).not.toBeNull();
		});

		it('files the arrival and pairing stamps under the administrative block, not the header', async () => {
			const { container } = open(syncedGroup());
			await screen.findAllByText('41.2');
			const admin = container.querySelector('details')!;
			expect(admin.open).toBe(false);
			const text = admin.textContent ?? '';
			expect(text).toContain(formatDateTime('2026-05-02T10:00:00Z'));
			expect(text).toContain('cnet · FP15:DOC_avg_ppb:reps');
			expect(container.textContent).not.toContain(`paired ${formatDateTime('2026-05-02T10:00:00Z')}`);
		});
	});

	describe('links each curve to its record', () => {
		it('wraps the calibration equation in a link to the calibration', async () => {
			const { container } = open(syncedGroup());
			await screen.findAllByText('41.2');
			const cal = container.querySelector('a[href="/admin/sensors/sensor-1?tab=calibrations&cal=cal-1"]');
			expect(cal).not.toBeNull();
			expect(cal!.textContent).toContain('1.043');
		});

		it('links the standard curve to the instrument that owns it', async () => {
			const { container } = open(syncedGroup());
			await screen.findAllByText('41.2');
			const curve = container.querySelector('a[href="/admin/sensors/lab-3?tab=curves&curve=curve-9"]');
			expect(curve).not.toBeNull();
			expect(curve!.textContent).toContain('Plate 7');
		});
	});

	it('links a discrepancy tag to the browse narrowed to this reading', async () => {
		const { container } = open(syncedGroup());
		await screen.findAllByText('41.2');
		const link = container.querySelector('a[href*="review=discrepancies"]')!;
		const params = new URL(link.getAttribute('href')!, 'http://x').searchParams;
		expect(params.get('tags_site')).toBe('site');
		expect(params.get('tags_parameter')).toBe('param');
		expect(params.get('tags_kind')).toBe('replicate_stats');
		expect(params.get('tags_from')).toBe('2026-07-14T09:00:00.000Z');
		expect(container.querySelector('a[href*="review=actionable"]')).toBeNull();
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
			expect(await screen.findAllByText('41.2')).toBeTruthy();
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
			await screen.findAllByText('41.2');
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
			decisionRows = ([
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
						computation: {},
						holds: [],
					},
				]) as unknown as ProvenanceResponse,
				onchange,
			});

			await screen.findByText('11');
			expect(getReadingProvenance).not.toHaveBeenCalled();
			(await screen.findByRole('button', { name: 'Roll back this reading' })).click();
			const dialog = await screen.findByRole('dialog');
			expect(dialog.textContent).toContain('Measured 11 → 8.005');
			expect(rollbackEdit).not.toHaveBeenCalled();
			(await screen.findByRole('button', { name: 'Roll back' })).click();

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
