import { describe, expect, it } from 'vitest';

import { decommissionText, recordDecommission } from './decommission';
import { formatDate } from '$lib/utils';

const decommission = { at: '2026-09-23T10:00:00Z', by: 'evan', reason: 'replaced by pco2_v2' };

describe('calculation decommission', () => {
	it('says when, by whom and why', () => {
		expect(decommissionText(decommission)).toBe(
			`Calculation decommissioned on ${formatDate(decommission.at)} by evan: replaced by pco2_v2`,
		);
	});

	it("reads a formula value's calculation, then a run value's", () => {
		expect(recordDecommission({ calculation: { decommissioned: decommission } as never })).toBe(decommission);
		expect(recordDecommission({ computation: { decommissioned: decommission } as never })).toBe(decommission);
	});

	it('reports none for a live calculation', () => {
		expect(recordDecommission({ calculation: {} as never, computation: {} as never })).toBeNull();
		expect(recordDecommission({})).toBeNull();
	});
});
