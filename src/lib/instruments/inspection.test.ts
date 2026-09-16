import { describe, expect, it } from 'vitest';
import {
	instrumentInspection,
	legacyInstrumentTabHref,
	streamInspectionHref,
} from './inspection';
import type { InstrumentOverview, InstrumentStreamRef } from '$api/service';

describe('instrument inspection', () => {
	it('selects the inventory row without exposing another instrument', () => {
		const rows = [
			{ id: 'wanted', streams: [{ id: 'stream-1' }] },
			{ id: 'other', streams: [{ id: 'stream-2' }] },
		] as InstrumentOverview[];

		expect(instrumentInspection(rows, 'wanted')?.streams).toEqual([{ id: 'stream-1' }]);
		expect(instrumentInspection(rows, 'missing')).toBeNull();
	});

	it('links an incoming stream back to its filtered sync row', () => {
		const stream = {
			source_system: 'cnet',
			source_key: 'station/oxygen',
		} as InstrumentStreamRef;

		expect(streamInspectionHref(stream)).toBe(
			'/streams?source=cnet&q=station%2Foxygen',
		);
	});

	it('forwards the removed sync tab to the consolidated inventory', () => {
		expect(legacyInstrumentTabHref('instruments', '/river')).toBe('/river/sensors');
		expect(legacyInstrumentTabHref('audits', '/river')).toBeNull();
	});
});
