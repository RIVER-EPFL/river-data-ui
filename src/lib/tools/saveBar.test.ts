import { describe, expect, it } from 'vitest';

import { checkSatisfied, checkState, consequenceLine } from './saveBar';

const impact = (label: string, codes: string[]) => ({
	label,
	outputs: codes.map((parameter_code) => ({ parameter_code })),
});

describe('the seasonal gate the bar reports', () => {
	it('is unchecked until something has been screened', () => {
		expect(checkState(null, 'site|[1]')).toBe('unchecked');
		expect(checkSatisfied(checkState(null, 'site|[1]'))).toBe(false);
	});

	it('covers the values it screened and no others', () => {
		expect(checkState('site|[1]', 'site|[1]')).toBe('checked');
		expect(checkSatisfied(checkState('site|[1]', 'site|[1]'))).toBe(true);
	});

	it('goes stale when a value moves after the check', () => {
		expect(checkState('site|[1]', 'site|[2]')).toBe('stale');
		expect(checkSatisfied(checkState('site|[1]', 'site|[2]'))).toBe(false);
	});
});

describe('what a save would re-run', () => {
	it('says nothing when the save feeds no calculation', () => {
		expect(consequenceLine([])).toBeNull();
	});

	it('names each calculation and the outputs it rewrites', () => {
		expect(consequenceLine([impact('DOC', ['DOC_avg_ppb'])])).toBe(
			'Saving re-runs 1 calculation at this visit: DOC (DOC_avg_ppb).',
		);
	});

	it('names a calculation that publishes nothing by itself', () => {
		expect(consequenceLine([impact('DOC', ['DOC_avg_ppb']), impact('DIC', [])])).toBe(
			'Saving re-runs 2 calculations at this visit: DOC (DOC_avg_ppb); DIC.',
		);
	});
});
