import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$api/client', () => ({ PATCH: vi.fn(), GET: vi.fn() }));
vi.mock('$api/crud', () => ({
	api: {
		sensorCalibrations: { get: vi.fn(async () => ({})) },
		standardCurves: { get: vi.fn(async () => ({})) },
	},
}));
// Provenance is a property of the reading, so the dialog asks the resolver, not the sample.
vi.mock('$api/service', () => ({
	getReadingProvenance: vi.fn(async () => ({ records: [] })),
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

beforeEach(() => vi.clearAllMocks());

describe('ReplicateFlagDialog', () => {
	it('gives every column its own header cell, none of them empty of an accessible name', () => {
		open();
		const headers = screen.getAllByRole('columnheader');
		const labels = headers.map((h) => (h.textContent ?? '').trim()).filter(Boolean);
		expect(labels).toEqual(['Replicate', 'Value (permil)', 'Calibration', 'Standard curve', 'State', 'Flag']);
	});

	// The Value column was sized to its header while its numbers were underlined links, so the
	// header ran into the next one.
	it('sizes the columns explicitly rather than letting the content set them', () => {
		const { container } = open();
		const cols = container.querySelectorAll('colgroup col');
		expect(cols.length).toBe(6);
		expect(Array.from(cols).every((c) => c.getAttribute('style'))).toBe(true);
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
});
