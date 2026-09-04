import { describe, expect, it } from 'vitest';
import { cellRecord, visitCellMarker, visitCellStatistics, visitCounts } from './cell';
import type { EventCell, EventCellReplicate, EventDetailResponse, VisitCell } from '$api/service';

function cell(over: Partial<VisitCell>): VisitCell {
	return {
		parameter_id: 'p',
		value: 3.42,
		flagged: false,
		withdrawn: false,
		n_total: 3,
		n_flagged: 0,
		n_withdrawn: 0,
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
		return { replicate_index: 0, raw_value: 1, flagged, withdrawn };
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
		readings: [{ replicate_index: 0, raw_value: 1, is_flagged: false }],
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
});
