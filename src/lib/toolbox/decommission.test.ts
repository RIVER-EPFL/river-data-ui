import { describe, expect, it } from 'vitest';

import { commissionLine, decommissionConsequence, recommissionOutcome } from './decommission';

describe('decommissionConsequence', () => {
	it('names the number of sites it stops at', () => {
		expect(decommissionConsequence(3)).toContain('the 3 sites it is active at');
		expect(decommissionConsequence(1)).toContain('the 1 site it is active at');
	});

	it('says so when it is active nowhere', () => {
		expect(decommissionConsequence(0)).toContain('active at no site');
	});

	it('claims no count it could not read', () => {
		expect(decommissionConsequence(null)).toContain('every site it is active at');
	});

	it('says what it leaves alone', () => {
		expect(decommissionConsequence(2)).toContain('nothing it computed is withdrawn');
	});

	it('says the name is freed and the decommission can be reversed', () => {
		expect(decommissionConsequence(2)).toContain('name is freed');
		expect(decommissionConsequence(2)).toContain('recommission');
	});
});

describe('recommissionOutcome', () => {
	it('names the name it came back under and says it is off', () => {
		expect(recommissionOutcome('pco2', true)).toBe('Recommissioned as pco2, switched off');
	});

	it('says why the name is not its own', () => {
		expect(recommissionOutcome('pco2_decommissioned_20260924', false)).toContain(
			'its former name is held by another calculation',
		);
	});
});

describe('commissionLine', () => {
	it('reads an event with who, the name held and why', () => {
		expect(
			commissionLine({ event: 'decommissioned', name: 'pco2', actor: 'admin', reason: 'false start' }),
		).toBe('Decommissioned by admin, as pco2: false start');
	});
});
