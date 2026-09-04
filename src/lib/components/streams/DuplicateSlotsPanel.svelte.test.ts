import { render, screen, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getDuplicateSlots = vi.fn();
vi.mock('$api/service', () => ({ getDuplicateSlots: () => getDuplicateSlots() }));

const DuplicateSlotsPanel = (await import('./DuplicateSlotsPanel.svelte')).default;

const slot = {
	site_id: 'site-1',
	site_name: 'FP15',
	parameter_id: 'param-1',
	parameter_name: 'DOC',
	site_parameter_id: 'sp-1',
	duplicated_instants: 4,
	streams: [
		{
			stream_id: 'stream-legacy',
			source_system: 'cnet',
			source_key: 'FP15:DOC_avg_ppb',
			readings: 120,
			first_reading: '2025-06-01T08:00:00Z',
			last_reading: '2026-01-01T08:00:00Z',
		},
		{
			stream_id: 'stream-family',
			source_system: 'cnet',
			source_key: 'FP15:DOC_avg_ppb:reps',
			readings: 360,
			first_reading: '2025-06-01T08:00:00Z',
			last_reading: '2026-01-01T08:00:00Z',
		},
	],
};

function open(slots: unknown[] = [slot]) {
	getDuplicateSlots.mockResolvedValue({ slots });
	return render(DuplicateSlotsPanel, {});
}

beforeEach(() => vi.clearAllMocks());

describe('DuplicateSlotsPanel', () => {
	it('names the slot, how many instants collide, and every feed behind it', async () => {
		open();
		const row = (await screen.findByRole('cell', { name: 'FP15' })).closest('tr')!;
		expect(within(row).getByText('DOC')).toBeTruthy();
		expect(within(row).getByText('4')).toBeTruthy();
		const feeds = within(row)
			.getAllByRole('listitem')
			.map((li) => (li.textContent ?? '').trim());
		expect(feeds[0]).toMatch(/^FP15:DOC_avg_ppb\b/);
		expect(feeds[0]).toContain('120 readings');
		expect(feeds[1]).toMatch(/^FP15:DOC_avg_ppb:reps/);
	});

	it('links the slot to the chart it is drawn on', async () => {
		open();
		const link = await screen.findByRole('link', { name: /FP15/ });
		expect(link.getAttribute('href')).toContain('/sites/site-1');
	});

	it('says nothing is duplicated rather than showing an empty table', async () => {
		open([]);
		expect(await screen.findByText(/No slot is fed by more than one stream/)).toBeTruthy();
	});

	it('reports a failure instead of an empty list', async () => {
		getDuplicateSlots.mockRejectedValue(new Error('boom'));
		render(DuplicateSlotsPanel, {});
		expect(await screen.findByText(/boom/)).toBeTruthy();
	});
});
