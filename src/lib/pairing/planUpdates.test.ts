import { describe, expect, it } from 'vitest';

import { movesPlanInstruments, splitPlanUpdates, type PlanUpdate } from './planUpdates';

describe('splitPlanUpdates', () => {
	it('routes each decision to the list the PATCH carries it in', () => {
		const batch = [
			{ stream_id: 's1', action: 'pair' },
			{ curve_id: 'c1', instrument_source_key: 'plan-key' },
			{ key: 'site:Martigny', create: true },
			{ source_key: 'SN-1', decision: 'admit' },
		] as unknown as PlanUpdate[];

		const split = splitPlanUpdates(batch);

		expect(split.entries).toEqual([{ stream_id: 's1', action: 'pair' }]);
		expect(split.curves).toEqual([{ curve_id: 'c1', instrument_source_key: 'plan-key' }]);
		expect(split.objects).toEqual([{ key: 'site:Martigny', create: true }]);
		expect(split.proposals).toEqual([{ source_key: 'SN-1', decision: 'admit' }]);
	});

	it('carries a curve move that clears the planned instrument', () => {
		const batch = [{ curve_id: 'c1', instrument_source_key: null }] as unknown as PlanUpdate[];
		expect(splitPlanUpdates(batch).curves).toHaveLength(1);
	});

	it('returns four empty lists for an empty batch', () => {
		expect(splitPlanUpdates([])).toEqual({ entries: [], curves: [], objects: [], proposals: [] });
	});
});

describe('movesPlanInstruments', () => {
	it('is true for a target parameter change, which the instrument view is keyed by', () => {
		const batch = [{ stream_id: 's1', parameter_name: 'DOC_site2' }] as unknown as PlanUpdate[];
		expect(movesPlanInstruments(batch)).toBe(true);
	});

	it('is true for a site change, which a device is grouped by', () => {
		const batch = [{ stream_id: 's1', site_name: 'Saxon' }] as unknown as PlanUpdate[];
		expect(movesPlanInstruments(batch)).toBe(true);
	});

	it('is false for decisions that leave the keys alone', () => {
		const batch = [
			{ stream_id: 's1', action: 'pair' },
			{ stream_id: 's1', parameter_units: 'mg/L' },
			{ key: 'site:Martigny', accepted: true },
		] as unknown as PlanUpdate[];
		expect(movesPlanInstruments(batch)).toBe(false);
	});
});
