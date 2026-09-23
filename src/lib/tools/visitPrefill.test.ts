import { describe, expect, it } from 'vitest';

import type { EventCell, ToolDescriptor, ToolParam } from '$api/service';
import {
	lastRunOfCalculation,
	openedFrom,
	prefillFromVisit,
	reopenStaging,
	runVisit,
} from './visitPrefill';

function param(over: Partial<ToolParam>): ToolParam {
	return {
		name: 'doc',
		label: 'DOC',
		kind: 'replicates',
		units: 'ppb',
		required: true,
		default: null,
		when: null,
		...over,
	};
}

function tool(over: Partial<ToolDescriptor> = {}): ToolDescriptor {
	return {
		name: 'doc',
		label: 'DOC',
		description: null,
		endpoint: '/api/tools/doc/calculate',
		params: [param({ parameter_code: 'DOC_ppb', curve: 'std_curve' })],
		outputs: [],
		constants: [],
		curves: [],
		match_keywords: [],
		script_version_id: 'v1',
		version_no: 1,
		...over,
	};
}

function cell(over: Partial<EventCell> = {}): EventCell {
	return {
		parameter_id: 'param-doc',
		parameter_code: 'DOC_ppb',
		parameter_name: 'DOC',
		stream_id: 'stream',
		origin: 'manual',
		has_provenance: false,
		replicates: [],
		...over,
	} as EventCell;
}

describe('opening a tool on a visit that already holds values', () => {
	it('loads the stored replicates in the source’s own column order', () => {
		const cells = [
			cell({
				replicates: [
					{ replicate_index: 1, raw_value: 122, flagged: false, withdrawn: false, unverified: false },
					{ replicate_index: 0, raw_value: 120, flagged: false, withdrawn: false, unverified: false },
				],
			}),
		];
		expect(prefillFromVisit(tool(), cells).doc).toEqual([120, 122]);
	});

	it('leaves a repeat that was not measured as a gap rather than shifting the rest', () => {
		const cells = [
			cell({
				replicates: [
					{ replicate_index: 0, raw_value: 120, flagged: false, withdrawn: false, unverified: false },
					{ replicate_index: 2, raw_value: 118, flagged: false, withdrawn: false, unverified: false },
				],
			}),
		];
		expect(prefillFromVisit(tool(), cells).doc).toEqual([120, null, 118]);
	});

	it('preselects the curve the stored replicates were corrected with', () => {
		const cells = [
			cell({
				replicates: [
					{ replicate_index: 0, raw_value: 120, flagged: false, withdrawn: false, unverified: false, standard_curve_id: 'curve-1' },
					{ replicate_index: 1, raw_value: 122, flagged: false, withdrawn: false, unverified: false, standard_curve_id: 'curve-1' },
				],
			}),
		];
		expect(prefillFromVisit(tool(), cells).std_curve).toBe('curve-1');
	});

	it('takes nothing from a visit that has no reading for the parameter', () => {
		expect(prefillFromVisit(tool(), [])).toEqual({});
		expect(prefillFromVisit(tool(), [cell({ parameter_code: 'pH' })])).toEqual({});
	});

	it('matches the parameter by id first and by code case-insensitively', () => {
		const withId = tool({
			params: [
				param({
					parameter_code: 'nothing-like-it',
					parameter: {
						id: 'param-doc',
						code: 'DOC_ppb',
						name: 'DOC',
						default_units: 'ppb',
						needs_review: false,
						resolved_by: 'id',
						dangling_parameter_id: false,
					},
				}),
			],
		});
		const cells = [
			cell({ replicates: [{ replicate_index: 0, raw_value: 9, flagged: false, withdrawn: false, unverified: false }] }),
		];
		expect(prefillFromVisit(withId, cells).doc).toEqual([9]);
		expect(
			prefillFromVisit(tool({ params: [param({ parameter_code: 'doc_PPB' })] }), cells).doc,
		).toEqual([9]);
	});

	it('puts a scalar the tool reads from the visit on screen as the visit serves it', () => {
		const t = tool({
			params: [param({ name: 'temp', kind: 'number', parameter_code: undefined, curve: undefined })],
			event_inputs: [{ param: 'temp', parameter_code: 'WaterTemp' }],
		});
		const cells = [cell({ parameter_code: 'WaterTemp', served_value: 7.5 })];
		expect(prefillFromVisit(t, cells).temp).toBe(7.5);
		// A replicates param already filled is not overwritten by the same parameter's scalar read.
		const both = tool({ event_inputs: [{ param: 'doc', parameter_code: 'DOC_ppb' }] });
		const docCells = [
			cell({
				served_value: 121,
				replicates: [{ replicate_index: 0, raw_value: 120, flagged: false, withdrawn: false, unverified: false }],
			}),
		];
		expect(prefillFromVisit(both, docCells).doc).toEqual([120]);
	});
});

describe('the run a row header reopens a calculation on', () => {
	function ran(tool: string, blob: Record<string, unknown>): EventCell {
		return {
			...cell(),
			written_by: tool,
			record: { computation: { provenance: { tool, ...blob } } },
		} as unknown as EventCell;
	}

	it('names the visit\u2019s most recent run of that calculation', () => {
		const cells = [
			ran('doc', { run_id: 'run-old', saved_at: '2026-03-01T08:00:00Z' }),
			ran('doc', { run_id: 'run-new', saved_at: '2026-03-01T11:00:00Z' }),
		];
		expect(lastRunOfCalculation('doc', cells)).toBe('run-new');
	});

	it('ignores another calculation\u2019s run at the same visit', () => {
		const cells = [ran('chla', { run_id: 'run-chla', saved_at: '2026-03-01T11:00:00Z' })];
		expect(lastRunOfCalculation('doc', cells)).toBeNull();
	});

	it('is null where the visit holds no run of it, so the form opens as a first run', () => {
		expect(lastRunOfCalculation('doc', [cell()])).toBeNull();
		expect(lastRunOfCalculation('doc', [ran('doc', {})])).toBeNull();
	});
});

describe('which arm filled the tool form', () => {
	const from = (query: string) => openedFrom(new URLSearchParams(query));

	it('is the visit\u2019s last run where the row header replayed one', () => {
		expect(from('tool=doc&reload=run-1&replay=visit')).toBe('visit-last-run');
	});

	it('is fresh for the cell marker, which names a run of its own choosing', () => {
		expect(from('tool=doc&reload=run-1')).toBe('fresh');
	});

	it('is fresh for a first run at a visit that has never run it', () => {
		expect(from('tool=doc')).toBe('fresh');
		expect(from('tool=doc&replay=visit')).toBe('fresh');
	});
});

describe('the visit a reopened run is staged at', () => {
	const staged = (siteId: string, collectedAt: string) => ({
		eventId: `event-${siteId}`,
		siteId,
		siteName: siteId,
		collectedAt,
	});

	it('reads the visit from the context the reload body carries', () => {
		expect(runVisit({ site_id: 'site-b', collected_at: '2026-09-16T09:45:00Z', doc: 1 })).toEqual({
			siteId: 'site-b',
			collectedAt: '2026-09-16T09:45:00Z',
		});
		expect(runVisit({ doc: 1 })).toBeNull();
		expect(runVisit({ site_id: 'site-b' })).toBeNull();
	});

	it('stages the run’s visit when none is staged', () => {
		const run = { siteId: 'site-b', collectedAt: '2026-09-16T09:45:00Z' };
		expect(reopenStaging(run, null)).toEqual({ action: 'stage', visit: run, replaced: null });
	});

	it('keeps the staged visit when it is the run’s, however the instant is written', () => {
		const run = { siteId: 'site-b', collectedAt: '2026-09-16T09:45:00Z' };
		expect(reopenStaging(run, staged('site-b', '2026-09-16T09:45:00.000Z'))).toEqual({
			action: 'keep',
		});
	});

	it('replaces a different staged visit, and names the one it replaced', () => {
		const run = { siteId: 'site-b', collectedAt: '2026-09-16T09:45:00Z' };
		const other = staged('site-a', '2026-09-16T09:45:00Z');
		expect(reopenStaging(run, other)).toEqual({ action: 'stage', visit: run, replaced: other });
		const earlier = staged('site-b', '2026-09-15T09:45:00Z');
		expect(reopenStaging(run, earlier)).toEqual({ action: 'stage', visit: run, replaced: earlier });
	});

	it('clears a staged visit for a run computed at none, so its save cannot land there', () => {
		const other = staged('site-a', '2026-09-16T09:45:00Z');
		expect(reopenStaging(null, other)).toEqual({ action: 'clear', replaced: other });
		expect(reopenStaging(null, null)).toEqual({ action: 'keep' });
	});
});
