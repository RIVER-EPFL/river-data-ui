import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getReadingProvenance = vi.fn();
vi.mock('$api/service', () => ({ getReadingProvenance: (q: unknown) => getReadingProvenance(q) }));

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
});
