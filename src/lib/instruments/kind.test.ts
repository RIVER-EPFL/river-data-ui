import { describe, it, expect } from 'vitest';
import {
	inUseCell,
	kindOf,
	kindLabel,
	isBookkeeping,
	instrumentFilter,
	isRetired,
	measuringInstruments,
	pickerOptions,
	provenanceOf,
	retiredSuffix,
} from './kind';
import type { Sensor } from '$api/crud';

const sensor = (kind: string | undefined, is_lab_instrument = false) =>
	({ kind, is_lab_instrument }) as never;

describe('instrument kinds', () => {
	it('names each kind', () => {
		expect(kindLabel(sensor('device'))).toBe('Field');
		expect(kindLabel(sensor('lab'))).toBe('Lab');
		expect(kindLabel(sensor('source_parameter'))).toBe('Source parameter');
		expect(kindLabel(sensor('entry_channel'))).toBe('Entry channel');
	});

	it('falls back to the lab flag for a row from an API that predates the column', () => {
		expect(kindOf(sensor(undefined, true))).toBe('lab');
		expect(kindOf(sensor(undefined, false))).toBe('device');
	});

	it('offers only what something could have been measured on', () => {
		expect(isBookkeeping(sensor('device'))).toBe(false);
		expect(isBookkeeping(sensor('lab'))).toBe(false);
		expect(isBookkeeping(sensor('source_parameter'))).toBe(true);
		expect(isBookkeeping(sensor('entry_channel'))).toBe(true);
		expect(
			measuringInstruments([sensor('device'), sensor('entry_channel'), sensor('lab')])
		).toHaveLength(2);
	});
});

describe('what an instrument picker offers', () => {
	const row = (id: string, kind: string, is_active = true) =>
		({ id, kind, is_lab_instrument: false, is_active }) as Pick<
			Sensor,
			'id' | 'kind' | 'is_lab_instrument' | 'is_active'
		>;

	it('leaves out the bookkeeping rows a CNET plan mints and the retired instruments', () => {
		const offered = pickerOptions([
			row('probe', 'device'),
			row('marker', 'source_parameter'),
			row('channel', 'entry_channel'),
			row('old', 'lab', false),
		]);
		expect(offered.map((s) => s.id)).toEqual(['probe']);
	});

	it('keeps whatever the row already declares, so a stored instrument is not replaced silently', () => {
		const sensors = [row('probe', 'device'), row('old', 'lab', false)];
		expect(pickerOptions(sensors, 'old').map((s) => s.id)).toEqual(['probe', 'old']);
		expect(pickerOptions(sensors, 'probe').map((s) => s.id)).toEqual(['probe']);
	});

	it('offers what it has when the declared instrument is not among the rows it was given', () => {
		expect(pickerOptions([row('probe', 'device')], 'gone').map((s) => s.id)).toEqual(['probe']);
	});
});

describe('inUseCell', () => {
	const relative = (iso: string) => `rel:${iso}`;
	const row = (over: Record<string, unknown>) => over as never;

	it('gives a device its deployment, and says so when it has none', () => {
		expect(inUseCell(row({ kind: 'device' }), '2025-06-01T00:00:00Z', relative).text).toBe(
			'rel:2025-06-01T00:00:00Z'
		);
		expect(inUseCell(row({ kind: 'device' }), null, relative).text).toBe('Undeployed');
	});

	it('gives a lab instrument its last curve use, which a deployment date never says', () => {
		const cell = inUseCell(
			row({ kind: 'lab', curve_count: 2, last_curve_use: '2025-07-04T09:00:00Z' }),
			null,
			relative
		);
		expect(cell.text).toBe('rel:2025-07-04T09:00:00Z');
		expect(cell.title).toContain('2 curves');
	});

	it('separates a lab instrument with unused curves from one with none', () => {
		expect(inUseCell(row({ kind: 'lab', curve_count: 3 }), null, relative).text).toBe('Unused');
		expect(inUseCell(row({ kind: 'lab', curve_count: 0 }), null, relative).text).toBe('No curves');
	});

	it('says the column does not apply to a bookkeeping row', () => {
		for (const kind of ['source_parameter', 'entry_channel']) {
			const cell = inUseCell(row({ kind, curve_count: 1 }), null, relative);
			expect(cell.text).toBe('—');
			expect(cell.title).toContain('Nothing was measured on it');
		}
	});

	it('falls back to the flag for a row predating the backfill', () => {
		expect(inUseCell(row({ is_lab_instrument: true, curve_count: 0 }), null, relative).text).toBe(
			'No curves'
		);
		expect(inUseCell(row({ is_lab_instrument: false }), null, relative).text).toBe('Undeployed');
	});
});

describe('instrument provenance', () => {
	const row = (over: Record<string, unknown> = {}) =>
		({ source_key: null, metadata: null, ...over }) as never;

	it('reports the register key that tells two same-named rows apart', () => {
		expect(provenanceOf(row({ source_key: 'sensor_inventory:87' })).key).toBe(
			'sensor_inventory:87',
		);
	});

	it('takes the portal register dates the inventory supplies', () => {
		const p = provenanceOf(
			row({
				source_key: 'sensor_inventory:87',
				metadata: { installation_date: '2021-06-14', in_field: true },
			}),
		);
		expect(p.installed).toBe('2021-06-14');
		expect(p.inField).toBe(true);
	});

	it('says nothing where the source said nothing', () => {
		expect(provenanceOf(row())).toEqual({ key: null, installed: null, inField: null });
		expect(provenanceOf(row({ metadata: { installation_date: null, in_field: null } }))).toEqual({
			key: null,
			installed: null,
			inField: null,
		});
	});
});

describe('retirement', () => {
	it('reads only an explicit false as retired', () => {
		expect(isRetired({ is_active: false } as Sensor)).toBe(true);
		expect(isRetired({ is_active: true } as Sensor)).toBe(false);
		expect(isRetired({ is_active: null } as unknown as Sensor)).toBe(false);
	});

	it('asks for active rows only until retired ones are wanted', () => {
		expect(instrumentFilter(false)).toEqual({ is_active: true });
	});

	it('asks for the whole inventory when retired rows are wanted', () => {
		expect(instrumentFilter(true)).toEqual({});
	});

	it('marks a retired row in the label and leaves an active one alone', () => {
		expect(retiredSuffix({ is_active: false } as Sensor)).toBe(' (retired)');
		expect(retiredSuffix({ is_active: true } as Sensor)).toBe('');
	});
});
