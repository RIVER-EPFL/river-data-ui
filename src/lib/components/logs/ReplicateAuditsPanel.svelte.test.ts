import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listReplicateAudits = vi.fn();
vi.mock('$api/service', () => ({
	listReplicateAudits: (q: unknown) => listReplicateAudits(q),
	acceptSourceCorrection: vi.fn(),
}));

const ReplicateAuditsPanel = (await import('./ReplicateAuditsPanel.svelte')).default;

function proposalHold(extra: Record<string, unknown> = {}) {
	return {
		id: 'hold-1',
		stream_id: 'stream-1',
		kind: 'source_modified',
		source_system: 'cnet',
		source_key: 'FP3:DOC',
		source_name: null,
		site_id: 'site',
		site_parameter_id: 'sp',
		site_name: 'FP3',
		parameter_name: 'DOC',
		parameter_code: 'DOC',
		tool: null,
		paired: true,
		group_time: '2026-07-14T09:00:00Z',
		expected: { value: 4.2 },
		computed: {},
		delta: {},
		status: 'pending',
		classification: '',
		resolution: null,
		created_at: '2026-07-15T04:00:00Z',
		acknowledged_by: null,
		acknowledged_at: null,
		relative_delta: 0,
		mean_relative_delta: 0,
		sd_relative_delta: 0,
		awaiting_inputs: [],
		...extra,
	};
}

function listing(holds: unknown[]) {
	return { holds, total: holds.length, pending: holds.length, deferred: 0, pending_by_kind: {} };
}

beforeEach(() => vi.clearAllMocks());

describe('ReplicateAuditsPanel', () => {
	it('asks only for the kinds a person still acts on', async () => {
		listReplicateAudits.mockResolvedValue(listing([]));
		render(ReplicateAuditsPanel, {});
		await screen.findByText('Nothing needs review');
		const kinds = listReplicateAudits.mock.calls[0][0].kind.split(',');
		expect(kinds).toEqual(['source_modified']);
	});

	it('offers the acknowledgement on a value changed at source', async () => {
		listReplicateAudits.mockResolvedValue(listing([proposalHold()]));
		render(ReplicateAuditsPanel, {});
		const cell = await screen.findByText('FP3 · DOC');
		await fireEvent.click(cell.closest('tr')!);
		await screen.findByRole('dialog');
		expect(screen.getAllByRole('button', { name: 'Acknowledge' }).length).toBeGreaterThan(0);
	});
});
