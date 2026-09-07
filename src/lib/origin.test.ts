import { describe, expect, it } from 'vitest';
import { originFilter, originLabel, originSource, provenanceKindLabel } from './origin';

describe('originFilter', () => {
	it('asks for nothing when no origin is chosen', () => {
		expect(originFilter('any', 'source_system')).toEqual({});
	});

	it('reads a sync arrival as the column being set', () => {
		expect(originFilter('sync', 'discovered_at')).toEqual({ discovered_at_neq: null });
		expect(originFilter('sync', 'source_system')).toEqual({ source_system_neq: null });
	});

	it('reads a hand-entered row as the column being null', () => {
		expect(originFilter('manual', 'discovered_at')).toEqual({ discovered_at: null });
	});

	it('names one source system exactly', () => {
		expect(originFilter('source:cnet', 'source_system')).toEqual({ source_system: 'cnet' });
	});

	// A source system is only ever recorded on `source_system`, so naming one while filtering the
	// stamp would silently return every row: the caller passes the column the entity actually has.
	it('keeps the chosen source on whichever column it was given', () => {
		expect(originFilter('source:metalp', 'discovered_at')).toEqual({ discovered_at: 'metalp' });
	});
});

describe('originLabel', () => {
	it('names the entry channels in the words the site page already uses', () => {
		expect(originLabel('grab_sample')).toBe('manual entry');
		expect(originLabel('csv_import')).toBe('CSV import');
		expect(originLabel('api')).toBe('API');
	});

	it('calls anything else a sync of that source', () => {
		expect(originLabel('cnet')).toBe('cnet sync');
	});
});

describe('originSource', () => {
	it('is null for the origins that name no source', () => {
		expect(originSource('any')).toBeNull();
		expect(originSource('sync')).toBeNull();
		expect(originSource('source:cnet')).toBe('cnet');
	});
});

describe('provenanceKindLabel', () => {
	it('names each stored origin in the words a reader uses', () => {
		expect(provenanceKindLabel('tool_run')).toBe('tool run');
		expect(provenanceKindLabel('manual')).toBe('hand entry');
		expect(provenanceKindLabel('migration')).toBe('origin not recorded');
	});

	it('passes an unknown kind through and says nothing about a row that carries none', () => {
		expect(provenanceKindLabel('something_new')).toBe('something_new');
		expect(provenanceKindLabel(undefined)).toBeUndefined();
	});
});
