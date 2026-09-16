import { describe, expect, it } from 'vitest';

import type { PairingPlanEntry } from '$api/service';
import type { Parameter } from '$api/crud';
import {
	creations,
	familySummary,
	instrumentBindings,
	instrumentGroups,
	parameterIndex,
	paramGroups,
	siteGroups,
	sitesWithoutCoordinates,
	type SiteCreation,
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

describe('creations', () => {
	const site = (name: string, over: Record<string, unknown> = {}) => ({
		id: null,
		name,
		create: true,
		latitude: 46.25,
		longitude: 7.75,
		altitude_m: 1,
		...over,
	});

	it('lists a site once however many feeds name it, and carries its attributes', () => {
		const made = creations([
			entry({ stream_id: 'a', site: site('WrongElevation') as never }),
			entry({ stream_id: 'b', site: site('WrongElevation') as never }),
		]);
		expect(made.sites).toEqual([
			{
				name: 'WrongElevation',
				latitude: 46.25,
				longitude: 7.75,
				altitudeM: 1,
				anchorStreamId: 'a',
				streamCount: 2,
			},
		]);
	});

	it('leaves out what the plan resolved to something that already exists', () => {
		const made = creations([
			entry({ site: site('Known', { create: false, id: 's1' }) as never }),
			entry({ stream_id: 'b', parameter: { ...entry().parameter, create: false } }),
		]);
		expect(made.sites).toEqual([]);
		expect(made.parameters).toEqual([]);
		expect(made.projects).toEqual([]);
	});

	it('leaves out entries the plan will skip', () => {
		const made = creations([
			entry({ action: 'skip', site: site('Skipped') as never }),
		]);
		expect(made.sites).toEqual([]);
	});

	it('counts a parameter once per name and units, over the sites it lands at', () => {
		const param = (units: string) => ({ ...entry().parameter, create: true, units });
		const made = creations([
			entry({ stream_id: 'a', parameter: param('mm') }),
			entry({ stream_id: 'b', parameter: param('mm'), site: site('Saxon') as never }),
			entry({ stream_id: 'c', parameter: param('m') }),
		]);
		expect(made.parameters).toEqual([
			{ name: 'Depth', units: 'm', siteCount: 1 },
			{ name: 'Depth', units: 'mm', siteCount: 2 },
		]);
	});
});

describe('instrumentBindings', () => {
	const bound = (over: Record<string, unknown> = {}) =>
		({
			id: 'sensor-doc',
			name: 'DOC',
			source_key: 'cnet:DOC',
			create: false,
			defaulted: false,
			...over,
		}) as never;

	it('counts an instrument once however many streams and sites it serves', () => {
		const rows = instrumentBindings([
			entry({ stream_id: 'a', instrument: bound() }),
			entry({
				stream_id: 'b',
				instrument: bound(),
				site: { ...entry().site, name: 'Saxon' },
			}),
		]);
		expect(rows).toEqual([
			{
				name: 'DOC',
				streamCount: 2,
				siteCount: 2,
				parameters: ['Depth'],
				create: false,
				defaulted: false,
			},
		]);
	});

	it('keeps the instruments that already exist, not only the ones the apply mints', () => {
		const rows = instrumentBindings([
			entry({ stream_id: 'a', instrument: bound() }),
			entry({
				stream_id: 'b',
				instrument: bound({ id: null, name: 'TSS', source_key: 'cnet:TSS', create: true }),
			}),
		]);
		expect(rows.map((r) => [r.name, r.create])).toEqual([
			['DOC', false],
			['TSS', true],
		]);
	});

	it('carries the registration default through, so the review can single it out', () => {
		const rows = instrumentBindings([
			entry({ instrument: bound({ defaulted: true }) }),
		]);
		expect(rows[0].defaulted).toBe(true);
	});

	it('leaves out skipped entries and entries with no instrument', () => {
		expect(
			instrumentBindings([
				entry({ stream_id: 'a', action: 'skip', instrument: bound() }),
				entry({ stream_id: 'b', instrument: null }),
			]),
		).toEqual([]);
	});

	it('resolves a catalog parameter by code, name or alias, first claim keeping the name', () => {
		const params = [
			{ id: 'a', code: 'DOC', name: 'Dissolved organic carbon', aliases: ['doc_ppb'] },
			{ id: 'b', code: 'doc_ppb', name: 'Second claimant', aliases: [] },
		] as unknown as Parameter[];
		const index = parameterIndex(params);
		expect(index.get('doc')?.id).toBe('a');
		expect(index.get('dissolved organic carbon')?.id).toBe('a');
		expect(index.get('doc_ppb')?.id).toBe('a');
		expect(index.get('unknown')).toBeUndefined();
	});

	it('reports the precision a group declares, and says so when its streams disagree', () => {
		const withPlaces = (places: number | null, over: Partial<PairingPlanEntry> = {}) =>
			entry({ decimal_places: places, ...over } as Partial<PairingPlanEntry>);
		expect(paramGroups([withPlaces(2), withPlaces(2)])[0]).toMatchObject({
			decimalPlaces: 2,
			decimalPlacesMixed: false,
		});
		expect(paramGroups([withPlaces(2), withPlaces(4)])[0]).toMatchObject({
			decimalPlaces: null,
			decimalPlacesMixed: true,
		});
		expect(paramGroups([withPlaces(null)])[0]).toMatchObject({
			decimalPlaces: null,
			decimalPlacesMixed: false,
		});
	});

	it('collects a group once behind every column of its category, in the registry order', () => {
		const withGroup = (param: string, ordinal: number) =>
			entry({
				stream_id: param,
				parameter: {
					id: null,
					name: param,
					label: null,
					create: true,
					units: '-',
					group_key: null,
					group: {
						id: null,
						code: 'field_data',
						label: 'Field data',
						ordinal,
						description: 'from the field sheet',
						create: true,
					},
					calculation: null,
					original_names: [],
				},
			} as Partial<PairingPlanEntry>);
		const made = creations([withGroup('Field_BP', 8), withGroup('WTW_pH_1', 3)]);
		expect(made.groups).toEqual([
			{
				code: 'field_data',
				label: 'Field data',
				description: 'from the field sheet',
				// Any column of the category: a rename sent on it renames all of them.
				anchorStreamId: 'Field_BP',
				members: ['WTW_pH_1', 'Field_BP'],
			},
		]);
	});

	it('proposes no group for a source that declares none, or one that already exists', () => {
		expect(creations([entry()]).groups).toEqual([]);
		const existing = entry({
			parameter: {
				id: null,
				name: 'Depth',
				label: null,
				create: true,
				units: 'mm',
				group_key: null,
				group: {
					id: 'group-1',
					code: 'field_data',
					label: 'Field data',
					ordinal: 1,
					role: 'measured',
					description: null,
					create: false,
				},
				calculation: null,
				original_names: [],
			},
		} as Partial<PairingPlanEntry>);
		expect(creations([existing]).groups).toEqual([]);
	});
});

describe('sitesWithoutCoordinates', () => {
	const at = (name: string, latitude: number | null, longitude: number | null): SiteCreation => ({
		name,
		latitude,
		longitude,
		altitudeM: 1500,
		anchorStreamId: `stream-${name}`,
		streamCount: 1,
	});

	it('names a site the apply would create with no position', () => {
		const sites = [at('Placed', 46.25, 7.75), at('Unplaced', null, null)];
		expect(sitesWithoutCoordinates(sites).map((s) => s.name)).toEqual(['Unplaced']);
	});

	it('counts half a position as no position', () => {
		expect(sitesWithoutCoordinates([at('Half', 46.25, null)])).toHaveLength(1);
		expect(sitesWithoutCoordinates([at('Other half', null, 7.75)])).toHaveLength(1);
	});

	it('treats a zero coordinate as a position', () => {
		expect(sitesWithoutCoordinates([at('Null Island', 0, 0)])).toHaveLength(0);
	});
});
