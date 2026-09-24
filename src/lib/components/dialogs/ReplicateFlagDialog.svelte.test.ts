import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const PATCH = vi.fn<(path: string, body: unknown) => Promise<{ updated: number }>>(async () => ({ updated: 1 }));
vi.mock('$api/client', () => ({ PATCH: (path: string, body: unknown) => PATCH(path, body), GET: vi.fn() }));
vi.mock('$api/crud', () => ({
	api: {
		sensorCalibrations: { get: vi.fn(async () => ({})) },
		standardCurves: { get: vi.fn(async () => ({})) },
	},
}));
// Provenance is a property of the reading, so the dialog asks the resolver, not the sample.
const previewSample = vi.fn();
vi.mock('$api/service', () => ({
	getReadingProvenance: vi.fn(async () => ({ records: [] })),
	previewSample: (b: unknown) => previewSample(b),
}));

const ReplicateFlagDialog = (await import('./ReplicateFlagDialog.svelte')).default;

function replicate(index: number, value: number) {
	return {
		replicate_index: index,
		raw_value: value,
		calibrated_value: null,
		calibration_id: null,
		standard_curve_id: null,
		flagged: false,
		withdrawn: false,
	};
}

function open() {
	return render(ReplicateFlagDialog, {
		open: true,
		siteId: 'site',
		parameterId: 'param',
		parameterName: 'DIC isotope',
		units: 'permil',
		timeIso: '2026-07-14T09:00:00Z',
		replicates: [replicate(0, 8.005), replicate(1, 8.117)],
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	previewSample.mockResolvedValue({
		current: { n: 2, mean: 8.061, sd: 0.0792 },
		proposed: { n: 1, mean: 8.005, sd: null },
		delta: { n: -1, mean: -0.056, sd: null },
		replicates: [],
	});
});

describe('ReplicateFlagDialog', () => {
	it('gives every column its own header cell, none of them empty of an accessible name', () => {
		open();
		const headers = screen.getAllByRole('columnheader');
		const labels = headers.map((h) => (h.textContent ?? '').trim()).filter(Boolean);
		expect(labels).toEqual(['Replicate', 'Value (permil)', 'Calibration', 'Standard curve', 'State', 'Flag']);
	});

	// Scenario: the dialog is 600px wide. Expected behaviour: the narrow columns are sized
	// explicitly and leave the two curve columns room, so the Flag column stays inside the dialog.
	it('fixes the narrow columns and leaves the curve columns the rest of the dialog', () => {
		const { container } = open();
		const cols = Array.from(container.querySelectorAll('colgroup col'));
		expect(cols.length).toBe(6);
		const fixed = cols.map((c) => Number(/width:\s*([\d.]+)rem/.exec(c.getAttribute('style') ?? '')?.[1] ?? 0));
		expect(fixed[2]).toBe(0);
		expect(fixed[3]).toBe(0);
		// 600px less the dialog's padding is 34.5rem; each curve column keeps at least 6rem.
		expect(fixed.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(34.5 - 12);
	});

	it('sets the numbers in right-aligned tabular figures', () => {
		open();
		const cell = screen.getByText('8.005').closest('td')!;
		expect(cell.className).toContain('text-right');
		expect(cell.className).toContain('tabular-nums');
	});

	it('carries the flagging explanation on the Flag header rather than as a paragraph above the table', () => {
		open();
		const flag = screen.getAllByRole('columnheader').find((h) => h.textContent?.trim() === 'Flag')!;
		expect(flag.getAttribute('title')).toContain('mean');
		expect(screen.queryByText(/Flagging one replicate excludes it from the sample mean/)).toBeNull();
	});

	// The reviewer sees what the mean and sd become before anything is written.
	it('previews the recomputed statistics when a replicate is chosen and writes only on confirm', async () => {
		open();
		const flagButtons = screen.getAllByRole('button', { name: 'Flag' });
		await fireEvent.click(flagButtons[1]);
		await waitFor(() => expect(previewSample).toHaveBeenCalled());
		expect(previewSample.mock.calls[0][0]).toMatchObject({
			site_id: 'site',
			parameter_id: 'param',
			time: '2026-07-14T09:00:00Z',
			exclude_replicate_indexes: [1],
		});
		const preview = await screen.findByTestId('sample-preview');
		expect(preview.textContent).toContain('8.005');
		expect(preview.textContent).toContain('sample');
		expect(preview.textContent).toMatch(/stays on the row/);
		expect(PATCH).not.toHaveBeenCalled();

		await fireEvent.input(screen.getByLabelText('Reason'), { target: { value: 'pipetting error' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Flag replicate 1' }));
		await waitFor(() => expect(PATCH).toHaveBeenCalledTimes(1));
		expect(PATCH.mock.calls[0][0]).toBe('/api/readings/flag');
		expect(PATCH.mock.calls[0][1]).toMatchObject({ reason: 'pipetting error' });
	});
});
