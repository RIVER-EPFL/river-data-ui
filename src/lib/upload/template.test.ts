import { describe, expect, it } from 'vitest';
import { templateRows, templateCsv } from './template';

const site = { name: 'Verbier' };
const params = [{ name: 'Depth' }, { name: 'Turbidity' }];

describe('templateRows', () => {
	it('emits one readings row per selected parameter for the chosen site', () => {
		const t = templateRows('readings', site, params);
		expect(t.headers).toEqual(['time', 'site', 'parameter', 'value', 'calibrated_value']);
		expect(t.rows.map((r) => r[1])).toEqual(['Verbier', 'Verbier']);
		expect(t.rows.map((r) => r[2])).toEqual(['Depth', 'Turbidity']);
	});

	it('emits two replicate rows per parameter for grab samples, sharing one time', () => {
		const t = templateRows('grab_samples', site, params);
		expect(t.headers).toEqual(['time', 'site', 'parameter', 'value']);
		expect(t.rows).toHaveLength(4);
		const depth = t.rows.filter((r) => r[2] === 'Depth');
		expect(depth).toHaveLength(2);
		expect(depth[0][0]).toBe(depth[1][0]);
		expect(depth[0][3]).not.toBe(depth[1][3]);
	});

	it('emits a text value for status events', () => {
		const t = templateRows('status_events', site, [{ name: 'Battery' }]);
		expect(t.rows).toEqual([[expect.any(String), 'Verbier', 'Battery', 'OK']]);
	});

	it('falls back to placeholders when nothing is selected', () => {
		const t = templateRows('readings', null, []);
		expect(t.rows).toEqual([[expect.any(String), 'Site name', 'Parameter name', '12.4', '']]);
	});
});

describe('templateCsv', () => {
	it('quotes a site name carrying a comma', () => {
		const csv = templateCsv(templateRows('readings', { name: 'Les Dailles, upper' }, params));
		expect(csv.split('\n')[1]).toContain('"Les Dailles, upper"');
		expect(csv.endsWith('\n')).toBe(true);
	});
});
