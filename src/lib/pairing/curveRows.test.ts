import { describe, expect, it } from 'vitest';

import type { PlanCurveAssignment, PlanHeldCurve, PlanInstruments } from '$api/service';
import { curveKey, curveReviewBlocked, curveRows, curveTitle } from './curveRows';

function held(over: Partial<PlanHeldCurve> = {}): PlanHeldCurve {
	return {
		id: 'held-1',
		source_key: 'standard_curves:17',
		label: 'DOC corr',
		name: null,
		slope: 2,
		intercept: 1,
		r_squared: null,
		fitted_on: null,
		attached: null,
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

function instruments(held_curves: PlanHeldCurve[], curves: PlanCurveAssignment[]): PlanInstruments {
	return { groups: [], unassigned: [], devices: [], curves, held_curves } as unknown as PlanInstruments;
}

describe('curveRows', () => {
	it('lists nothing while the instruments are loading', () => {
		expect(curveRows(null)).toEqual([]);
	});

	it('puts the held curves before the stored ones and keys each by id', () => {
		const rows = curveRows(instruments([held()], [stored()]));
		expect(rows.map((r) => [r.kind, r.key])).toEqual([
			['held', 'curve:held-1'],
			['stored', 'curve:stored-1'],
		]);
	});

	it('reads a curve as reviewed from the plan keys', () => {
		const rows = curveRows(instruments([held()], [stored()]), [curveKey('stored-1')]);
		expect(rows.map((r) => r.reviewed)).toEqual([false, true]);
	});
});

describe('curveReviewBlocked', () => {
	it('holds the review of a curve attached to nothing', () => {
		const [row] = curveRows(instruments([held()], []));
		expect(curveReviewBlocked(row!)).toBe('Attach it to an instrument first');
	});

	it('lets an attached held curve and a stored curve be reviewed', () => {
		const attached = held({
			attached: { instrument_source_key: 'cnet:DOC', instrument_id: null, instrument_name: 'DOC', create: true },
		});
		const rows = curveRows(instruments([attached], [stored()]));
		expect(rows.map(curveReviewBlocked)).toEqual([null, null]);
	});
});

describe('curveTitle', () => {
	it('names a held curve by the source label until it has a name', () => {
		const [unnamed] = curveRows(instruments([held()], []));
		const [named] = curveRows(instruments([held({ name: 'DOC corr 2025' })], []));
		expect(curveTitle(unnamed!)).toBe('DOC corr');
		expect(curveTitle(named!)).toBe('DOC corr 2025');
	});
});
