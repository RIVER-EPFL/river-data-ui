import { describe, expect, it } from 'vitest';

import { decommissionConsequence } from './decommission';

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
});
