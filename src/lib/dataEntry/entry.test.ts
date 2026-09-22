import { describe, expect, it } from 'vitest';

import { dataEntryHref, newEntryRequest, reopenRunHref } from './entry';

describe('newEntryRequest', () => {
	it('stages the station at the instant the timestamp control resolved', () => {
		expect(newEntryRequest('site-1', '2025-06-15T09:00:00.000Z')).toEqual({
			request: { site_id: 'site-1', collected_at: '2025-06-15T09:00:00.000Z' },
		});
	});

	it('asks for a station before anything is staged', () => {
		expect(newEntryRequest('', '2025-06-15T09:00:00.000Z')).toEqual({ error: 'Choose a station' });
	});

	it('asks for a date before anything is staged', () => {
		expect(newEntryRequest('site-1', '')).toEqual({ error: 'Choose a date' });
	});
});

describe('dataEntryHref', () => {
	it('keeps the query a /tools link carried', () => {
		expect(dataEntryHref('/admin', '?tool=doc&reload=run-1')).toBe('/admin/data-entry?tool=doc&reload=run-1');
	});

	it('is the bare page with no query', () => {
		expect(dataEntryHref('/admin', '')).toBe('/admin/data-entry');
	});
});

describe('reopenRunHref', () => {
	it('reopens the run a provenance blob names', () => {
		expect(reopenRunHref('/admin', { tool: 'doc', run_id: 'run-1', inputs: { doc: [1] } })).toBe(
			'/admin/data-entry?tool=doc&reload=run-1',
		);
	});

	it('offers nothing for a blob with no run', () => {
		expect(reopenRunHref('/admin', { tool: 'doc', inputs: { doc: [1] } })).toBeNull();
	});

	it('offers nothing for a blob with no tool', () => {
		expect(reopenRunHref('/admin', { run_id: 'run-1' })).toBeNull();
	});
});
