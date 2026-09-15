import { describe, expect, it } from 'vitest';
import {
	classificationLabel,
	originFilter,
	originLabel,
	originSource,
	provenanceKindLabel,
	rowProvenanceLabel,
} from './origin';

// What the API emits, from `classify_source` and `PROVENANCE_KINDS` in
// river-data-api/src/routes/private/readings/service.rs.
const CLASSIFICATIONS = ['manual', 'csv', 'api', 'derived', 'sync'];
const PROVENANCE_KINDS = ['tool_run', 'chain', 'csv_import', 'manual', 'batch', 'sync', 'derived'];

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
	it('says where the value came from rather than how it was typed', () => {
		expect(originLabel('grab_sample')).toBe('entered in the grid');
		expect(originLabel('csv_import')).toBe('CSV import');
		expect(originLabel('api')).toBe('API batch');
	});

	it('calls anything else a sync of that source', () => {
		expect(originLabel('cnet')).toBe('cnet sync');
	});

	it('names the actor where the surface knows one', () => {
		expect(originLabel('grab_sample', { actor: 'nora' })).toBe('entered in the grid by nora');
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
		expect(provenanceKindLabel('tool_run')).toBe('computed by a tool');
		expect(provenanceKindLabel('manual')).toBe('entered in the grid');
		expect(provenanceKindLabel('derived')).toBe('computed by a derived parameter');
	});

	it('names the calculation where the surface knows one', () => {
		expect(provenanceKindLabel('tool_run', { calculation: 'doc' })).toBe('computed by doc');
	});

	it('passes an unknown kind through and says nothing about a row that carries none', () => {
		expect(provenanceKindLabel('something_new')).toBe('something_new');
		expect(provenanceKindLabel(undefined)).toBeUndefined();
	});
});

describe('rowProvenanceLabel', () => {
	it('prefers the row\'s own kind over the stream it arrived on', () => {
		expect(rowProvenanceLabel('csv_import', 'cnet')).toBe('CSV import');
	});

	it('falls back to the source system, spelled as the badge spells it', () => {
		expect(rowProvenanceLabel(undefined, 'cnet')).toBe('cnet sync');
	});

	it('says nothing about a row that names neither', () => {
		expect(rowProvenanceLabel(undefined, undefined)).toBeUndefined();
	});
});

// The defect this vocabulary closes: one origin was spelled 'manual entry' on the chart tooltip,
// 'hand entry' on the record's history and 'Manual entry' in its header.
describe('one origin, one phrase', () => {
	it('spells an entry the same way whichever column names it', () => {
		const phrase = 'entered in the grid';
		expect(originLabel('grab_sample')).toBe(phrase);
		expect(provenanceKindLabel('manual')).toBe(phrase);
		expect(classificationLabel('manual')).toBe(phrase);
	});

	it('spells a sync the same way whichever column names it', () => {
		expect(originLabel('cnet')).toBe('cnet sync');
		expect(classificationLabel('sync', 'cnet')).toBe('cnet sync');
	});

	it('gives every classification the API emits a phrase of its own', () => {
		const phrases = CLASSIFICATIONS.map((c) => classificationLabel(c));
		expect(phrases).not.toContain(undefined);
		expect(new Set(phrases).size).toBe(CLASSIFICATIONS.length);
	});

	it('gives every provenance kind the API emits a phrase of its own', () => {
		const phrases = PROVENANCE_KINDS.map((k) => provenanceKindLabel(k));
		expect(phrases).not.toContain(undefined);
		expect(new Set(phrases).size).toBe(PROVENANCE_KINDS.length);
	});
});
