import { render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProvenanceResponse } from '$api/service';
import { formatDateTime } from '$lib/utils';

const getReadingProvenance = vi.fn();
const getReadingDecisions = vi.fn();
const getReadingLedger = vi.fn();
const rollbackEdit = vi.fn();
const rollbackEditSet = vi.fn();
const reopenReplicateAudit = vi.fn();
vi.mock('$api/service', () => ({
	getReadingProvenance: (q: unknown) => getReadingProvenance(q),
	getReadingDecisions: (q: unknown) => getReadingDecisions(q),
	getReadingLedger: (q: unknown) => getReadingLedger(q),
	rollbackEdit: (id: string) => rollbackEdit(id),
	rollbackEditSet: (id: string) => rollbackEditSet(id),
	reopenReplicateAudit: (id: string) => reopenReplicateAudit(id),
}));

/** The ledger arm of a decision the panel also reads through `/readings/decisions`. */
function decisionEntry(id: string, what: string, at: string) {
	return { id, source: 'decision', severity: 'info', actor: 'lab', what, at };
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
});

describe('PointInspector', () => {
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
		getReadingDecisions.mockResolvedValue([verify('v0', 0), verify('v1', 1)]);
		reopenReplicateAudit.mockResolvedValue({ status: 'pending' });
		open(handEntered());
		await screen.findByText('8.005');
		(await screen.findByText('Show history')).click();
		await screen.findByText('Entry verified');
		expect(screen.queryByText('Roll back')).toBeNull();
		(await screen.findByText('Reopen ruling')).click();
		await waitFor(() => expect(reopenReplicateAudit).toHaveBeenCalledWith('hold-1'));
		expect(rollbackEdit).not.toHaveBeenCalled();
		expect(rollbackEditSet).not.toHaveBeenCalled();
	});

	it('reads one history from every record that holds part of it, filtered by severity', async () => {
		getReadingDecisions.mockResolvedValue([]);
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
		(await screen.findByText('Show history')).click();
		expect(await screen.findByText('Manual reprocess failed: the pool timed out')).toBeTruthy();
		const held = 'Statistics disagreement raised, waiting for a ruling';
		expect(screen.getByText(held)).toBeTruthy();

		(await screen.findByText('Failures')).click();
		await vi.waitFor(() => expect(screen.queryByText(held)).toBeNull());
		expect(screen.getByText('Manual reprocess failed: the pool timed out')).toBeTruthy();
	});

	// Scenario: a fresh value whose history is a recompute that moved nothing and two catalogue
	// inserts. Expected behaviour: no arm code reaches the screen, and the three sit under
	// Administrative rather than above the decision that set the value.
	it('leads on what moved the value and fades what only administers it', async () => {
		getReadingDecisions.mockResolvedValue([
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
		(await screen.findByText('Show history')).click();
		await screen.findByText('Value corrected');

		const text = container.textContent ?? '';
		expect(text).not.toContain('site_parameter_insert');
		expect(text).not.toContain('parameter_insert');
		expect(text).not.toContain('event_recompute');
		expect(screen.getByText('Parameter added at this site')).toBeTruthy();
		expect(screen.getByText('Visit recompute completed')).toBeTruthy();

		const corrected = text.indexOf('Value corrected');
		expect(corrected).toBeLessThan(text.indexOf('Visit recompute completed'));
		expect(corrected).toBeLessThan(text.indexOf('Parameter added at this site'));
	});

	it('folds an administrative history past the newest three behind its count', async () => {
		getReadingDecisions.mockResolvedValue([]);
		getReadingLedger.mockResolvedValue({
			time: '2026-07-14T09:00:00Z',
			entries: Array.from({ length: 5 }, (_, n) => ({
				id: `c${n}`,
				source: 'change',
				severity: 'info',
				what: 'site_parameter_update',
				at: `2026-07-1${n}T10:00:00Z`,
			})),
			truncated: false,
		});
		const slot = 'How this site serves the parameter changed';
		open(handEntered());
		await screen.findByText('8.005');
		(await screen.findByText('Show history')).click();
		await screen.findByText('Administrative (5), show all');
		expect(screen.getAllByText(slot)).toHaveLength(3);

		(await screen.findByText('Administrative (5), show all')).click();
		await screen.findByText('Administrative (5), show fewer');
		expect(screen.getAllByText(slot)).toHaveLength(5);
	});

	it('opens a job entry on the job it names, and a tag entry on the discrepancies at this reading', async () => {
		getReadingDecisions.mockResolvedValue([]);
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
		(await screen.findByText('Show history')).click();
		await screen.findByText('Visit recompute completed');
		const hrefs = Array.from(container.querySelectorAll('li a')).map((a) => a.getAttribute('href'));
		expect(hrefs.filter((h) => h === '/admin/system?tab=jobs&job=job-1')).toHaveLength(2);
		expect(hrefs.some((h) => h?.includes('review=discrepancies') && h.includes('tags_kind=replicate_stats'))).toBe(true);
	});

	it('writes an absent value as a plain hyphen and never an em dash', async () => {
		const { container } = open(syncedGroup());
		await screen.findAllByText('41.2');
		expect(container.textContent).not.toContain('—');
		expect(screen.getAllByText('-').length).toBeGreaterThan(0);
	});

	it('sets the numbers in right-aligned tabular figures', async () => {
		open(handEntered());
		const cell = (await screen.findByText('8.005')).closest('dd')!;
		expect(cell.className).toContain('text-right');
		expect(cell.className).toContain('tabular-nums');
	});

	it('names the sample formula as a tip on the standard deviation rather than a paragraph', async () => {
		open(syncedGroup());
		await screen.findAllByText('41.2');
		const sd = screen.getByText('Standard deviation').closest('div')!;
		expect(sd.getAttribute('title')).toContain('sample standard deviation (n-1)');
	});

	// A continuous value computed by a standalone formula: no run, and the formula version the
	// stored value names.
	function computed(calculation: Record<string, unknown>, consumed?: unknown[]) {
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
		expect(text.indexOf('pCO2 v2, now at v3')).toBeLessThan(text.indexOf('Measured'));
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
			for (const led of ['Replicates', 'Mean', 'Standard deviation', 'Instrument', 'Entered by']) {
				expect(strip).toContain(led);
			}
			expect(strip).not.toContain('Administrative');
			expect(details[0].querySelector('table')).not.toBeNull();
			expect(details[0].textContent).toContain('Administrative');
			expect(details[0].textContent).toContain('Show history');
			const actions = screen.getByRole('group', { name: 'Actions' });
			expect(actions.textContent).not.toContain('Show history');
		});

		it('reads the statistics as one line rather than a column of rows', async () => {
			const { container } = open(syncedGroup());
			await screen.findAllByText('41.2');
			const line = screen.getByText('Standard deviation').parentElement!.parentElement!;
			expect(line.className).toContain('flex');
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
						computation: {},
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
