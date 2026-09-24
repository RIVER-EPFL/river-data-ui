import { describe, expect, it } from 'vitest';

import { takeoverText } from './takeover';
import type { ParameterTakeover } from '$api/service';

const portal: ParameterTakeover = {
	at: '2026-09-25T08:00:00Z',
	by: 'evan',
	kind: 'portal',
	computed_by: 'calcCO2',
	calculation: 'pco2real',
	calculation_id: 'c-1',
};

describe('the line for a series that changed hands', () => {
	it('names who continued it, when, and what computed it before', () => {
		const line = takeoverText('CO2_HS_Um', portal);
		expect(line).toMatch(/^CO2_HS_Um continued by pco2real from .+ \(evan\); computed before by the portal's calcCO2$/);
	});

	it('names a decommissioned calculation, and a takeover with no recorded author', () => {
		const line = takeoverText('pco2_out', { ...portal, kind: 'decommissioned', computed_by: 'pco2', by: null });
		expect(line).toMatch(/^pco2_out continued by pco2real from [^(]+; computed before by the decommissioned calculation pco2$/);
	});
});
