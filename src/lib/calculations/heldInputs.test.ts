import { describe, expect, it } from 'vitest';
import { heldInSet, heldOf, holdable, holdWarning } from './heldInputs';

const source = (variable_name: string, alignment: string) =>
	({ id: variable_name, derived_definition_id: 'd', parameter_id: 'p', variable_name, alignment, created_at: '' });

describe('heldOf', () => {
	it('names the variables a formula holds and no other', () => {
		expect(heldOf([source('co2', 'exact'), source('alkalinity', 'hold')])).toEqual(['alkalinity']);
	});

	it('names nothing where the formula has no sources yet', () => {
		expect(heldOf(undefined)).toEqual([]);
	});
});

describe('heldInSet', () => {
	it('names a variable two formulas hold once', () => {
		expect(heldInSet([{ held: ['alkalinity'] }, { held: ['alkalinity', 'silica'] }])).toEqual([
			'alkalinity',
			'silica',
		]);
	});

	it('names nothing for a set that reads everything at the instant', () => {
		expect(heldInSet([{ held: [] }, {}])).toEqual([]);
	});
});

describe('holdWarning', () => {
	it('says nothing about a set that holds nothing', () => {
		expect(holdWarning([])).toBe('');
	});

	it('names one held input and what it does between visits', () => {
		expect(holdWarning(['alkalinity'])).toContain('alkalinity is held between visits');
		expect(holdWarning(['alkalinity'])).toContain('until the next visit measures a new one');
	});

	it('names several', () => {
		expect(holdWarning(['alkalinity', 'silica'])).toContain(
			'alkalinity, silica are held between visits',
		);
	});
});

describe('holdable', () => {
	const row = (band: string, code: string | null = null) => ({ band, code });

	it('offers the rule on a parameter read as one value per visit', () => {
		expect(holdable(row('single'))).toBe(true);
	});

	it('offers it on nothing else the sheet holds', () => {
		for (const band of ['replicated', 'fixed', 'step', 'read', 'final', 'statistics']) {
			expect(holdable(row(band)), band).toBe(false);
		}
		expect(holdable(row('single', 'CO2_HS_Um')), 'a computed row is not read').toBe(false);
		expect(holdable(null)).toBe(false);
	});
});
