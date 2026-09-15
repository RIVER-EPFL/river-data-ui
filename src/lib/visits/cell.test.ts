import { describe, expect, it } from 'vitest';
import {
	cellRecord,
	findingLabel,
	recordMarkerTitle,
	showsProvenanceMarker,
	statisticsParts,
	visitCellMarker,
	visitCellStatistics,
	visitCounts,
} from './cell';
import type { EventCell, EventCellReplicate, EventDetailResponse, VisitCell } from '$api/service';
import type { GridRow } from './grid';

function cell(over: Partial<VisitCell>): VisitCell {
	return {
		parameter_id: 'p',
		value: 3.42,
		flagged: false,
		withdrawn: false,
		n_total: 3,
		n_flagged: 0,
		n_withdrawn: 0,
		n_unverified: 0,
		...over,
	};
}

describe('visitCellMarker', () => {
	it('marks nothing on a clean cell', () => {
		expect(visitCellMarker(cell({}))).toBeNull();
	});

	// The wide table's only signal for a fully flagged group was its text colour, which sits a
	// shade off the body text and disappears in monochrome.
	it('marks a fully flagged group with the same asterisk the expanded grid uses', () => {
		const marker = visitCellMarker(cell({ flagged: true, n_flagged: 3 }));
		expect(marker?.text).toBe('*');
		expect(marker?.title).toContain('flagged');
	});

	it('marks a partly flagged group, whose mean excludes the exclusions', () => {
		expect(visitCellMarker(cell({ n_flagged: 1 }))?.text).toBe('*');
	});

	it('marks a withdrawn group with the dagger, not the asterisk', () => {
		const marker = visitCellMarker(cell({ withdrawn: true, n_withdrawn: 3 }));
		expect(marker?.text).toBe('†');
		expect(marker?.title).toContain('withdrawn');
	});

	it('marks a group that is both, so neither signal is lost', () => {
		expect(visitCellMarker(cell({ n_flagged: 1, n_withdrawn: 1 }))?.text).toBe('*†');
	});

	it('says how many of how many, so the mark is readable without expanding the row', () => {
		expect(visitCellMarker(cell({ n_flagged: 1, n_total: 3 }))?.title).toContain('1 of 3');
	});

	// An intern's entry is stored and drawn like any other number, and counted by nothing.
	it('marks a pending group, which no statistic counts', () => {
		const marker = visitCellMarker(cell({ n_unverified: 3 }));
		expect(marker?.text).toBe('?');
		expect(marker?.title).toContain('not yet verified');
	});
});

describe('visitCellStatistics', () => {
	it('says why the statistics are empty when every replicate is pending', () => {
		const line = visitCellStatistics(cell({ n: 0, n_unverified: 3 }));
		expect(line).toContain('n = 0');
		expect(line).toContain('not counted until verified');
	});

	it('offers a line for a single measurement, which the serving arm counts as one', () => {
		expect(visitCellStatistics(cell({ n: 1, n_total: 1 }))).toBe('n = 1');
	});

	it('stays silent on a cell holding nothing at all', () => {
		expect(visitCellStatistics(cell({ n: 0, n_total: 0 }))).toBeNull();
	});
});

describe('visitCounts', () => {
	function eventCell(over: Partial<EventCell>): EventCell {
		return {
			parameter_id: 'p',
			parameter_code: 'DOC',
			parameter_name: 'DOC',
			stream_id: 's',
			origin: 'manual',
			has_provenance: false,
			replicates: [],
			...over,
		};
	}
	function rep(flagged = false, withdrawn = false): EventCellReplicate {
		return { replicate_index: 0, raw_value: 1, flagged, withdrawn, unverified: false };
	}

	it('counts parameters, replicates, flagged, withdrawn and findings over the grid', () => {
		const counts = visitCounts([
			eventCell({ replicates: [rep(), rep(true), rep(false, true)] }),
			eventCell({ parameter_id: 'q', replicates: [rep()], finding: { id: 'f', kind: 'missing_output', status: 'pending' } }),
		]);
		expect(counts).toEqual({ parameters: 2, replicates: 4, flagged: 1, withdrawn: 1, findings: 1 });
	});

	it('is all zeros for an empty grid', () => {
		expect(visitCounts([])).toEqual({ parameters: 0, replicates: 0, flagged: 0, withdrawn: 0, findings: 0 });
	});
});

function detailWith(cells: EventDetailResponse['cells']): EventDetailResponse {
	return {
		id: 'ev',
		site_id: 'site',
		collected_at: '2026-07-14T09:00:00Z',
		source: 'manual',
		recompute: 'current',
		cells,
	};
}

function eventCell(parameterId: string, streamId: string, record: EventCell['record']): EventCell {
	return {
		parameter_id: parameterId,
		parameter_code: 'DOC',
		parameter_name: 'DOC',
		stream_id: streamId,
		origin: 'manual',
		has_provenance: false,
		replicates: [],
		record,
	};
}

function recordFor(streamId: string): NonNullable<EventCell['record']> {
	return {
		origin: { stream_id: streamId, source_system: 'grab_sample', source_key: 'k', classification: 'manual' },
		readings: [{ replicate_index: 0, unverified: false, raw_value: 1, is_flagged: false }],
		chain: {},
		holds: [],
	};
}

describe('cellRecord', () => {
	it('shapes one parameter of the detail as the provenance response the point record renders', () => {
		const detail = detailWith([eventCell('p1', 's1', recordFor('s1')), eventCell('p2', 's2', recordFor('s2'))]);
		const resp = cellRecord(detail, 'p1');
		expect(resp.time).toBe('2026-07-14T09:00:00Z');
		expect(resp.site_id).toBe('site');
		expect(resp.parameter_id).toBe('p1');
		expect(resp.duplicate_slot).toBe(false);
		expect(resp.records.map((r) => r.origin.stream_id)).toEqual(['s1']);
	});

	it('reports a duplicate slot when two streams serve the parameter at the visit', () => {
		const detail = detailWith([eventCell('p1', 's1', recordFor('s1')), eventCell('p1', 's2', recordFor('s2'))]);
		const resp = cellRecord(detail, 'p1');
		expect(resp.duplicate_slot).toBe(true);
		expect(resp.records).toHaveLength(2);
	});

	it('yields no records for a finding-only cell, which has no readings', () => {
		const detail = detailWith([eventCell('p1', '00000000-0000-0000-0000-000000000000', undefined)]);
		expect(cellRecord(detail, 'p1').records).toEqual([]);
	});
});

describe('visitCellStatistics', () => {
	it('says nothing for a cell with no group behind it', () => {
		expect(visitCellStatistics(cell({ n: undefined }))).toBeNull();
	});

	it('names the divisor beside the sd it printed', () => {
		const line = visitCellStatistics(
			cell({ n: 3, stdev: 0.5, median: 2, min: 1, max: 3, sd_estimator: 'population' }),
			1,
			'ppb'
		);
		expect(line).toContain('SD 0.5 ppb (population, n)');
		expect(line).toContain('median 2.0 ppb');
		expect(line).toContain('range 1.0 to 3.0 ppb');
	});

	it('says so when no divisor was declared, rather than passing the fallback off as a choice', () => {
		const line = visitCellStatistics(
			cell({ n: 2, stdev: 1, sd_estimator: 'sample', sd_estimator_source: 'default' })
		);
		expect(line).toContain('divisor not declared');
	});

	it('renders an undeclared slot the way every other surface does, not as the stored double', () => {
		const line = visitCellStatistics(
			cell({ n: 3, stdev: 0.1 + 0.2, median: 2.5, min: 1, max: 3 }),
			null,
			'mg/L'
		);
		expect(line).toContain('SD 0.3 mg/L');
		expect(line).not.toContain('0.30000000000000004');
	});
});

describe('statisticsParts', () => {
	// The expanded cell serves both divisors, so the line names each one and formats it like every
	// other number on the row.
	it('formats both divisors to the slot\'s declared precision', () => {
		const parts = statisticsParts(
			{
				n: 3,
				sd_estimator: 'sample',
				sd_estimator_source: 'declared',
				stdev: 0.1 + 0.2,
				stdev_sample: 0.1 + 0.2,
				stdev_population: 0.2451,
			},
			2,
			'mg/L'
		);
		expect(parts).toContain('sample, n-1: 0.30 mg/L');
		expect(parts).toContain('population, n: 0.25 mg/L');
		expect(parts.join(' ')).not.toContain('0.30000000000000004');
	});

	it('leaves out a divisor the group does not carry', () => {
		const parts = statisticsParts({ n: 3, stdev: 0.5, sd_estimator: 'sample' });
		expect(parts.some((p) => p.startsWith('population, n:'))).toBe(false);
	});
});

describe('recordMarkerTitle', () => {
	const row = (over: Partial<GridRow>): GridRow =>
		({
			parameterId: 'p',
			parameterCode: 'DOC_ppb',
			parameterName: 'DOC',
			role: 'plain',
			roleTitle: null,
			roleClass: '',
			readBy: [],
			replicates: [],
			stats: null,
			streamId: 's',
			hasProvenance: true,
			...over,
		}) as GridRow;

	it('names the tool that wrote the value ahead of the coarser origin', () => {
		expect(recordMarkerTitle(row({ tool: 'doc', provenanceKind: 'tool_run', origin: 'manual' }))).toBe(
			'What produced this value (written by doc)'
		);
	});

	it('spells the kind the way the record it opens spells it', () => {
		expect(recordMarkerTitle(row({ provenanceKind: 'csv_import', origin: 'csv' }))).toBe(
			'What produced this value (CSV import)'
		);
		expect(recordMarkerTitle(row({ provenanceKind: 'sync', origin: 'sync' }))).toBe(
			'What produced this value (sync service)'
		);
	});

	it('falls back to the source system the stream names, as the badge spells it', () => {
		expect(recordMarkerTitle(row({ origin: 'sync', sourceSystem: 'cnet' }))).toBe(
			'What produced this value (cnet sync)'
		);
	});

	it('carries an open finding, which is the reason to look', () => {
		expect(recordMarkerTitle(row({ tool: 'doc', finding: 'stale_output' }))).toBe(
			'What produced this value (written by doc, open finding: stale output)'
		);
	});

	it('promises only the record when nothing about the origin is known', () => {
		expect(recordMarkerTitle(row({}))).toBe('What produced this value');
	});
});

describe('showsProvenanceMarker', () => {
	const row = (over: Partial<GridRow>) =>
		({
			parameterId: 'p',
			parameterCode: 'DOC_ppb',
			parameterName: 'DOC',
			role: 'plain',
			roleTitle: null,
			roleClass: '',
			readBy: [],
			replicates: [],
			stats: null,
			streamId: 's',
			hasProvenance: true,
			...over,
		}) as GridRow;

	it('draws on a row that carries a record', () => {
		expect(showsProvenanceMarker(row({ record: {} as GridRow['record'] }))).toBe(true);
	});

	it('draws on a finding with no reading behind it, which would otherwise read as an empty row', () => {
		expect(showsProvenanceMarker(row({ finding: 'missing_output' }))).toBe(true);
	});

	it('draws on nothing when the row has neither', () => {
		expect(showsProvenanceMarker(row({}))).toBe(false);
	});
});

describe('findingLabel', () => {
	it('gives each kind its word, and an unknown kind the missing one', () => {
		expect(findingLabel('stale_output')).toBe('stale');
		expect(findingLabel('skipped_output')).toBe('skipped');
		expect(findingLabel('missing_output')).toBe('missing');
		expect(findingLabel('something_new')).toBe('missing');
	});
});
