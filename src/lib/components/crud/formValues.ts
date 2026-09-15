import type { Field } from './CrudForm.svelte';

/** The value a field holds before anyone types into it. */
export function initialValues(fields: Field[]): Record<string, unknown> {
	const values: Record<string, unknown> = {};
	for (const f of fields) {
		if (f.defaultValue !== undefined) values[f.key] = f.defaultValue;
		else if (f.type === 'boolean') values[f.key] = false;
		else if (f.type === 'number') values[f.key] = null;
		else if (f.type === 'tags') values[f.key] = [];
		else values[f.key] = '';
	}
	return values;
}

/** The body sent to the API: disabled fields are left out, an empty text field is null. */
export function buildPayload(fields: Field[], values: Record<string, unknown>): Record<string, unknown> {
	const payload: Record<string, unknown> = {};
	for (const f of fields) {
		if (f.disabled) continue;
		let v = values[f.key];
		if (f.type === 'number' && v !== null && v !== '') v = Number(v);
		if (f.type === 'tags') v = Array.isArray(v) ? v : [];
		else if (v === '') v = null;
		payload[f.key] = v;
	}
	return payload;
}
