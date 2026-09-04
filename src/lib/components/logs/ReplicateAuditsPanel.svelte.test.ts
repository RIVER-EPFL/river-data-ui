import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listReplicateAudits = vi.fn();
const previewSample = vi.fn();
vi.mock('$api/service', () => ({
	listReplicateAudits: (q: unknown) => listReplicateAudits(q),
	acknowledgeReplicateAudit: vi.fn(),
	acknowledgeReplicateAuditsBulk: vi.fn(),
	resolveReplicateAudit: vi.fn(),
	reopenReplicateAudit: vi.fn(),
	listUndeclaredSdEstimators: vi.fn(async () => ({ slots: [] })),
	previewSample: (b: unknown) => previewSample(b),
	issueSyncCommand: vi.fn(),
	getSyncCommand: vi.fn(),
	stageCollectionEvent: vi.fn(),
	recomputeCollectionEvent: vi.fn(),
	pollJob: vi.fn(),
}));
vi.mock('$api/client', () => ({ getList: vi.fn(async () => ({ data: [] })) }));

const ReplicateAuditsPanel = (await import('./ReplicateAuditsPanel.svelte')).default;

// A hold raised for a count mismatch on a slot that had already declared population: its sd
// was computed with divisor n.
function populationHold(extra: Record<string, unknown> = {}) {
	return {
		id: 'hold-1',
		stream_id: 'stream-1',
		kind: 'replicate_stats',
		source_system: 'cnet',
		source_key: 'FP3:DOC_avg_ppb:reps',
		source_name: null,
		site_id: 'site',
		site_name: 'FP3',
		parameter_name: 'DOC',
		parameter_code: 'DOC_avg_ppb',
		tool: null,
		paired: true,
		group_time: '2026-07-14T09:00:00Z',
		expected: { mean: 20, sd: 8.16, n: 4 },
		computed: {
			mean: 20,
			sd: 8.164965809277259,
			n: 3,
			sd_estimator: 'population',
			values: [
				{ index: 0, value: 10 },
				{ index: 1, value: 20 },
				{ index: 2, value: 30 },
			],
		},
		delta: { mean: 0, sd: -0.005, n: 1 },
		sd_estimator: 'population',
		status: 'pending',
		classification: 'n_mismatch',
		resolution: null,
		created_at: '2026-07-15T04:00:00Z',
		acknowledged_by: null,
		acknowledged_at: null,
		relative_delta: 0.0003,
		mean_relative_delta: 0,
		sd_relative_delta: 0.0003,
		...extra,
	};
}

function listing(holds: unknown[]) {
	return { holds, total: holds.length, pending: holds.length, deferred: 0, pending_by_kind: {} };
}

async function openDetail(hold: Record<string, unknown>) {
	listReplicateAudits.mockResolvedValue(listing([hold]));
	const utils = render(ReplicateAuditsPanel, {});
	const cell = await screen.findByText('FP3 · DOC');
	await fireEvent.click(cell.closest('tr')!);
	await screen.findByRole('dialog');
	return utils;
}

beforeEach(() => {
	vi.clearAllMocks();
	previewSample.mockResolvedValue({
		current: { n: 3, mean: 20, sd: 8.164965809277259, sd_estimator: 'population' },
		proposed: { n: 2, mean: 15, sd: 5, sd_estimator: 'population' },
		delta: { n: -1, mean: -5, sd: -3.164965809277259 },
		replicates: [],
		hold: {
			hold_id: 'hold-1',
			expected_mean: 20,
			expected_sd: 8.16,
			expected_n: 4,
			meets_now: false,
			meets_after: false,
			mean_agrees: false,
			sd_agrees: false,
			n_agrees: false,
		},
	});
});

describe('ReplicateAuditsPanel', () => {
	it('labels the sd of a population-declared hold with the population formula, not STDDEV_SAMP', async () => {
		await openDetail(populationHold());
		const dialog = screen.getByRole('dialog');
		expect(dialog.textContent).toContain('SD (population, n)');
		const titles = Array.from(dialog.querySelectorAll('[title]')).map((el) => el.getAttribute('title') ?? '');
		expect(titles.some((t) => t.includes('STDDEV_POP'))).toBe(true);
		expect(titles.some((t) => t.includes('STDDEV_SAMP'))).toBe(false);
	});

	it('labels an undeclared hold with the sample formula it was computed with', async () => {
		await openDetail(populationHold({ sd_estimator: 'sample', computed: { mean: 20, sd: 10, n: 3, values: [] } }));
		const dialog = screen.getByRole('dialog');
		expect(dialog.textContent).toContain('SD (sample, n-1)');
	});

	// The source's average is never applied, so there is nothing to accept or reject: the
	// review records that the computed statistics were looked at.
	it('frames the review as marking reviewed, never as accepting our statistics over the source', async () => {
		await openDetail(populationHold());
		expect(screen.queryByText(/Accept our statistics/)).toBeNull();
		expect(screen.getAllByRole('button', { name: 'Mark reviewed' }).length).toBeGreaterThan(0);
		expect(document.body.textContent).toContain('never applied');
	});

	it('renders a reviewed hold as Reviewed and a legacy applied one as legacy', async () => {
		listReplicateAudits.mockResolvedValue(
			listing([populationHold({ status: 'acknowledged' }), populationHold({ id: 'hold-2', status: 'use_portal' })]),
		);
		render(ReplicateAuditsPanel, {});
		await screen.findAllByText('FP3 · DOC');
		expect(screen.getByText('Reviewed')).toBeTruthy();
		expect(screen.queryByText('Accepted')).toBeNull();
		expect(screen.getByText('Legacy: source value applied')).toBeTruthy();
	});

	// The reviewer decides with the recomputed numbers in front of them, not after the write.
	it('previews the statistics without a selected replicate and says whether the hold is met', async () => {
		await openDetail(populationHold());
		const box = screen.getAllByRole('checkbox').find((c) => c.closest('label')?.textContent?.includes('replicate 2'))!;
		await fireEvent.click(box);
		await waitFor(() => expect(previewSample).toHaveBeenCalled());
		expect(previewSample.mock.calls[0][0]).toMatchObject({
			stream_id: 'stream-1',
			time: '2026-07-14T09:00:00Z',
			exclude_replicate_indexes: [2],
			hold_id: 'hold-1',
		});
		const preview = await screen.findByTestId('sample-preview');
		expect(preview.textContent).toContain('15');
		expect(preview.textContent).toContain('population');
		expect(preview.textContent).toMatch(/does not meet/i);
	});
});
