import { describe, expect, it } from 'vitest';
import { axisLabel } from './multiSiteAxis';

describe('axisLabel', () => {
	it('names the unit when every site reports the same one', () => {
		expect(axisLabel('CDOM', 'ppb', false)).toBe('CDOM (ppb)');
	});

	it('drops the unit when the sites disagree, rather than labelling the axis with one of them', () => {
		expect(axisLabel('CDOM', 'ppb', true)).toBe('CDOM');
	});

	it('names the parameter alone when the catalog carries no unit', () => {
		expect(axisLabel('CDOM', null, false)).toBe('CDOM');
	});
});
