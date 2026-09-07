import { describe, expect, it } from 'vitest';

import type { PairingPlanEntry } from '$api/service';
import {
	familySummary,
	instrumentGroups,
	paramGroups,
	sdDecisions,
	siteGroups,
} from './planGroups';

function entry(over: Partial<PairingPlanEntry> = {}): PairingPlanEntry {
	return {
		stream_id: 'stream',
		source_key: 'STA:Depth',
		source_name: null,
		action: 'pair',
		project: { id: 'p', name: 'BREATHE', create: false },
		site: { id: 's', name: 'Martigny', create: false, latitude: null, longitude: null, altitude_m: null },
		parameter: {
			id: 'par',
			name: 'Depth',
			label: null,
			create: false,
			units: 'mm',
			group_key: null,
			original_names: [],
		},
		confidence: 'exact',
		warnings: [],
		original_parameter_name: null,
		replicates: null,
		instrument: null,
		...over,
	} as PairingPlanEntry;
}

const instrument = (over = {}) =>
	({ id: null, name: 'DOC analyser', create: true, confirmed: true, ...over }) as never;

describe('siteGroups', () => {
	it('counts pairs, skips and warnings per site, in name order', () => {
		const groups = siteGroups([
			entry({ stream_id: 'a', site: { ...entry().site, name: 'Saxon' } }),
			entry({ stream_id: 'b', action: 'skip' }),
			entry({ stream_id: 'c', warnings: [{ kind: 'x', message: 'm' }] as never }),
		]);
		expect(groups.map((g) => g.siteName)).toEqual(['Martigny', 'Saxon']);
		const martigny = groups[0];
		expect(martigny.pairCount).toBe(1);
		expect(martigny.skipCount).toBe(1);
		expect(martigny.warningCount).toBe(1);
		expect(martigny.project).toBe('BREATHE');
	});
});

describe('instrumentGroups', () => {
	it('groups by the instrument identity, so many streams are one decision', () => {
		const shared = instrument({ curve_column: 'DOC_curve' });
		const groups = instrumentGroups([
			entry({ stream_id: 'a', instrument: shared }),
			entry({
				stream_id: 'b',
				instrument: shared,
				site: { ...entry().site, name: 'Saxon' },
				parameter: { ...entry().parameter, name: 'DOC' },
			}),
		]);
		expect(groups).toHaveLength(1);
		expect(groups[0]).toMatchObject({
			key: 'DOC_curve',
			streamCount: 2,
			siteCount: 2,
			parameters: ['DOC', 'Depth'],
			anchorStreamId: 'a',
		});
	});

	it('leaves out entries the plan will not pair, and entries with no instrument', () => {
		expect(
			instrumentGroups([
				entry({ action: 'skip', instrument: instrument({ curve_column: 'c' }) }),
				entry({ stream_id: 'b' }),
			]),
		).toEqual([]);
	});
});

describe('familySummary', () => {
	it('counts the source columns the families collapse, over the entries that will pair', () => {
		const replicates = { member_columns: ['a', 'b', 'c'] } as never;
		expect(
			familySummary([
				entry({ replicates }),
				entry({ stream_id: 'b', action: 'skip', replicates }),
				entry({ stream_id: 'c' }),
			]),
		).toEqual({ streams: 1, columns: 3 });
	});
});

describe('paramGroups', () => {
	it('keys on name and units, so one name in two units is two rows', () => {
		const groups = paramGroups([
			entry({ stream_id: 'a' }),
			entry({
				stream_id: 'b',
				parameter: { ...entry().parameter, units: 'm' },
			}),
		]);
		expect(groups.map((g) => g.units)).toEqual(['m', 'mm']);
	});

	it('collects the sites, streams and distinct warnings under one row', () => {
		const warning = [{ kind: 'x', message: 'same' }] as never;
		const groups = paramGroups([
			entry({ stream_id: 'a', warnings: warning }),
			entry({
				stream_id: 'b',
				action: 'skip',
				warnings: warning,
				site: { ...entry().site, name: 'Saxon' },
			}),
		]);
		expect(groups).toHaveLength(1);
		expect(groups[0]).toMatchObject({
			siteCount: 2,
			streamIds: ['a', 'b'],
			warnings: ['same'],
			pairCount: 1,
		});
	});
});

describe('sdDecisions', () => {
	const withSd = (over: Partial<PairingPlanEntry> = {}, estimator?: string) =>
		entry({
			replicates: { member_columns: ['a', 'b'], portal_sd_column: 'DOC_sd' } as never,
			...over,
			...(estimator ? ({ sd_estimator: estimator } as object) : {}),
		});

	it('reads one declaration for the parameter when every station agrees', () => {
		const decisions = sdDecisions([
			withSd({ stream_id: 'a', sd_holds: 2 } as never, 'population'),
			withSd({ stream_id: 'b', sd_population_holds: 1 } as never, 'population'),
		]);
		expect(decisions).toHaveLength(1);
		expect(decisions[0]).toMatchObject({
			paramName: 'Depth',
			declared: 'population',
			holds: 2,
			population: 1,
		});
	});

	it('reports mixed declarations as undeclared, which is what the operator is asked', () => {
		const decisions = sdDecisions([
			withSd({ stream_id: 'a' }, 'population'),
			withSd({ stream_id: 'b' }, 'sample'),
		]);
		expect(decisions[0].declared).toBe('');
	});

	it('ignores a family whose source ships no sd column', () => {
		expect(sdDecisions([entry({ replicates: { member_columns: ['a'] } as never })])).toEqual([]);
	});
});
