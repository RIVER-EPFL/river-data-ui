import { describe, expect, it } from 'vitest';

import { defaultFilter, readingsFilter } from './listFilter';

describe('defaultFilter', () => {
	it('opens on the last seven days with nothing else set', () => {
		const now = new Date('2026-09-17T12:00:00Z');
		const state = defaultFilter(now);
		expect(state.from).toBe('2026-09-10T12:00:00.000Z');
		expect(state.to).toBe('');
		expect(readingsFilter(state)).toEqual({ time_gte: '2026-09-10T12:00:00.000Z' });
	});
});

describe('readingsFilter', () => {
	it('asks the entity only for what is set', () => {
		const state = {
			...defaultFilter(),
			from: '',
			siteId: 'site-1',
			parameterId: 'param-1',
			instrumentId: 'sensor-1',
			curveId: 'curve-1',
			kind: 'sync',
		};
		expect(readingsFilter(state)).toEqual({
			site_id: 'site-1',
			parameter_id: 'param-1',
			sensor_id: 'sensor-1',
			standard_curve_id: 'curve-1',
			provenance_kind: 'sync',
		});
	});

	it('bounds the period on both sides', () => {
		const state = { ...defaultFilter(), from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' };
		expect(readingsFilter(state)).toEqual({
			time_gte: '2026-01-01T00:00:00Z',
			time_lte: '2026-02-01T00:00:00Z',
		});
	});

	it('reads flagged as a three-way choice and unverified as a switch', () => {
		const base = { ...defaultFilter(), from: '' };
		expect(readingsFilter({ ...base, flagged: 'flagged' })).toEqual({ is_flagged: true });
		expect(readingsFilter({ ...base, flagged: 'clean' })).toEqual({ is_flagged: false });
		expect(readingsFilter({ ...base, unverifiedOnly: true })).toEqual({ unverified: true });
	});
});
