import { describe, expect, it } from 'vitest';

import { takeoverLine } from './takeover';
import type { Takeover } from '$api/service';

const portal: Takeover = {
	code: 'CO2_HS_Um',
	parameter_id: 'p-1',
	parameter_name: 'CO2 headspace',
	units: 'umol/L',
	kind: 'portal',
	computed_by: 'calcCO2',
	readings: 141,
	first_reading: '2021-03-02T10:00:00Z',
	last_reading: '2026-09-01T09:00:00Z',
	source_systems: ['cnet'],
};

describe('what a takeover confirm says', () => {
	it('names the readings, what computed them and what the catalog row keeps', () => {
		expect(takeoverLine(portal, (d) => d.slice(0, 10))).toBe(
			'CO2_HS_Um holds 141 readings from 2021-03-02 to 2026-09-01 (cnet), computed by the portal\'s calcCO2. ' +
				'Saving continues that series under this calculation; the column keeps its name, CO2 headspace, and its units, umol/L.',
		);
	});

	it('names a decommissioned calculation, and a column with nothing stored yet', () => {
		const line = takeoverLine(
			{ ...portal, kind: 'decommissioned', computed_by: 'pco2', readings: 0, first_reading: null, last_reading: null, source_systems: [] },
			(d) => d,
		);
		expect(line).toBe(
			'CO2_HS_Um holds no readings yet, computed by the decommissioned calculation pco2. ' +
				'Saving continues that series under this calculation; the column keeps its name, CO2 headspace, and its units, umol/L.',
		);
	});
});
