import { describe, expect, it } from 'vitest';
import { buildPayload, initialValues } from './formValues';
import type { Field } from './CrudForm.svelte';

const FIELDS: Field[] = [
	{ key: 'code', label: 'Code' },
	{ key: 'aliases', label: 'Aliases', type: 'tags' },
	{ key: 'description', label: 'Description', type: 'textarea' },
	{ key: 'decimals', label: 'Decimals', type: 'number' },
	{ key: 'id', label: 'ID', disabled: true },
];

describe('initialValues', () => {
	it('starts a tags field as an empty list', () => {
		expect(initialValues(FIELDS).aliases).toEqual([]);
	});

	it('honours an explicit default over the type default', () => {
		expect(initialValues([{ key: 'aliases', label: 'Aliases', type: 'tags', defaultValue: ['pH'] }]).aliases)
			.toEqual(['pH']);
	});
});

describe('buildPayload', () => {
	// Scenario: the New parameter form, submitted with no alias typed in.
	it('sends an untouched tags field as an empty list, not null', () => {
		const values = { ...initialValues(FIELDS), code: 'hs_co2_ppm' };
		expect(buildPayload(FIELDS, values).aliases).toEqual([]);
	});

	it('sends the aliases that were typed', () => {
		const values = { ...initialValues(FIELDS), aliases: ['co2', 'CO2_ppm'] };
		expect(buildPayload(FIELDS, values).aliases).toEqual(['co2', 'CO2_ppm']);
	});

	it('nulls an empty text field and numbers a filled numeric one', () => {
		const values = { ...initialValues(FIELDS), decimals: '3' };
		const payload = buildPayload(FIELDS, values);
		expect(payload.description).toBeNull();
		expect(payload.decimals).toBe(3);
	});

	it('leaves a disabled field out', () => {
		expect('id' in buildPayload(FIELDS, initialValues(FIELDS))).toBe(false);
	});
});
