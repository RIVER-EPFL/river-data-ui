import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

import type { PlanCurveAssignment, PlanHeldCurve, PlanInstruments } from '$api/service';

const CurvesTab = (await import('./CurvesTab.svelte')).default;

// Scenario: a portal's first sync holds its curves, because the portal names no instrument for
// them, and the plan has to put each on one of its instruments before it can be applied (Q195).
// A curve is reviewed like a parameter: once, on the instrument it sits on.

function held(over: Partial<PlanHeldCurve> = {}): PlanHeldCurve {
	return {
		id: 'held-1',
		source_key: 'standard_curves:17',
		label: 'DOC corr',
		name: 'DOC corr 2025-01-01',
		slope: 2,
		intercept: 1,
		r_squared: null,
		fitted_on: '2025-01-01',
		attached: null,
		skipped: false,
		skipped_by: null,
		...over,
	};
}

function stored(over: Partial<PlanCurveAssignment> = {}): PlanCurveAssignment {
	return {
		id: 'stored-1',
		name: 'DOC 2024',
		slope: 1,
		intercept: 0,
		r_squared: null,
		source_key: 'standard_curves:3',
		sensor_id: 'sensor-1',
		instrument_name: 'Shimadzu TOC',
		reading_count: 12,
		corrected_parameters: ['DOC'],
		corrected_sites: ['FP1'],
		first_corrected: null,
		last_corrected: null,
		pending_source_key: null,
		pending_instrument_name: null,
		...over,
	};
}

function mount(
	heldCurves: PlanHeldCurve[],
	curves: PlanCurveAssignment[] = [],
	reviewedKeys = new Set<string>(),
) {
	const planInstruments = {
		groups: [],
		unassigned: [],
		devices: [],
		curves,
		held_curves: heldCurves,
	} as unknown as PlanInstruments;
	const onattach = vi.fn();
	const onskip = vi.fn();
	const onreview = vi.fn();
	render(CurvesTab, {
		props: {
			planInstruments,
			labInstruments: [{ id: 'sensor-1', name: 'Shimadzu TOC', serial_number: null }],
			plannedInstruments: [{ sourceKey: 'cnet:DOC', name: 'DOC' }],
			planInstrumentPrefix: 'plan:',
			reviewedKeys,
			editing: null,
			editValue: '',
			oncommitname: vi.fn(),
			onrehome: vi.fn(),
			onattach,
			onskip,
			onreview,
			onmarkall: vi.fn(),
			marking: false,
		} as never,
	});
	return { onattach, onskip, onreview };
}

describe('CurvesTab held curves', () => {
	it('says an unattached curve blocks the apply and holds its review', () => {
		mount([held()]);
		expect(screen.getByText('DOC corr 2025-01-01')).not.toBeNull();
		expect(screen.getByText('Attach it, or skip it, before the plan can be applied')).not.toBeNull();
		const review = screen.getByRole('button', { name: 'Mark reviewed' }) as HTMLButtonElement;
		expect(review.disabled).toBe(true);
		expect(review.title).toBe('Attach it to an instrument, or skip it, first');
	});

	it('shows the instrument an attached curve will be created under', () => {
		mount([
			held({
				attached: {
					instrument_source_key: 'cnet:DOC',
					instrument_id: null,
					instrument_name: 'DOC',
					create: true,
				},
			}),
		]);
		const select = screen.getByLabelText('Instrument for DOC corr 2025-01-01') as HTMLSelectElement;
		expect(select.value).toBe('plan:cnet:DOC');
		expect(screen.queryByText('Attach it, or skip it, before the plan can be applied')).toBeNull();
	});

	it('attaches to the instrument chosen', async () => {
		const { onattach } = mount([held()]);
		const select = screen.getByLabelText('Instrument for DOC corr 2025-01-01') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'plan:cnet:DOC' } });
		expect(onattach).toHaveBeenCalledWith(expect.objectContaining({ id: 'held-1' }), 'plan:cnet:DOC');
	});

	it('skips a curve the lab does not want', async () => {
		const { onskip } = mount([held()]);
		await fireEvent.click(screen.getByRole('button', { name: 'Skip this curve' }));
		expect(onskip).toHaveBeenCalledWith(expect.objectContaining({ id: 'held-1' }), true);
	});

	it('shows a skipped curve as ruled on, with the way back', async () => {
		const { onskip } = mount([held({ skipped: true, skipped_by: 'evan' })]);
		expect(screen.getByText('Skipped by evan')).not.toBeNull();
		expect(screen.queryByLabelText('Instrument for DOC corr 2025-01-01')).toBeNull();
		const review = screen.getByRole('button', { name: 'Mark reviewed' }) as HTMLButtonElement;
		expect(review.disabled).toBe(false);
		await fireEvent.click(screen.getByRole('button', { name: 'Keep it after all' }));
		expect(onskip).toHaveBeenCalledWith(expect.objectContaining({ id: 'held-1' }), false);
	});
});

describe('CurvesTab review', () => {
	it('lists held and stored curves in one table, the held ones first', () => {
		mount([held()], [stored()]);
		const rows = screen.getAllByRole('row').slice(1);
		expect(rows[0]?.textContent).toContain('DOC corr 2025-01-01');
		expect(rows[1]?.textContent).toContain('DOC 2024');
		expect(screen.getByText('2 curves')).not.toBeNull();
	});

	it('reviews a stored curve by its key', async () => {
		const { onreview } = mount([], [stored()]);
		await fireEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }));
		expect(onreview).toHaveBeenCalledWith(expect.objectContaining({ key: 'curve:stored-1' }), true);
	});

	it('counts a reviewed curve on the filter strip', () => {
		mount([], [stored()], new Set(['curve:stored-1']));
		expect(screen.getByRole('button', { name: 'Reviewed 1' })).not.toBeNull();
		expect(screen.getByRole('button', { name: '✓ Reviewed' })).not.toBeNull();
	});
});
