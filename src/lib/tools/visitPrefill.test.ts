import { describe, expect, it } from 'vitest';

import type { EventCell, ToolDescriptor, ToolParam } from '$api/service';
import { hasVisitPrefill, prefillFromVisit } from './visitPrefill';

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
					{ replicate_index: 1, raw_value: 122, flagged: false, withdrawn: false },
					{ replicate_index: 0, raw_value: 120, flagged: false, withdrawn: false },
				],
			}),
		];
		expect(prefillFromVisit(tool(), cells).doc).toEqual([120, 122]);
	});

	it('leaves a repeat that was not measured as a gap rather than shifting the rest', () => {
		const cells = [
			cell({
				replicates: [
					{ replicate_index: 0, raw_value: 120, flagged: false, withdrawn: false },
					{ replicate_index: 2, raw_value: 118, flagged: false, withdrawn: false },
				],
			}),
		];
		expect(prefillFromVisit(tool(), cells).doc).toEqual([120, null, 118]);
	});

	it('preselects the curve the stored replicates were corrected with', () => {
		const cells = [
			cell({
				replicates: [
					{ replicate_index: 0, raw_value: 120, flagged: false, withdrawn: false, standard_curve_id: 'curve-1' },
					{ replicate_index: 1, raw_value: 122, flagged: false, withdrawn: false, standard_curve_id: 'curve-1' },
				],
			}),
		];
		expect(prefillFromVisit(tool(), cells).std_curve).toBe('curve-1');
	});

	it('takes nothing from a visit that has no reading for the parameter', () => {
		expect(prefillFromVisit(tool(), [])).toEqual({});
		expect(prefillFromVisit(tool(), [cell({ parameter_code: 'pH' })])).toEqual({});
		expect(hasVisitPrefill(tool(), [])).toBe(false);
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
			cell({ replicates: [{ replicate_index: 0, raw_value: 9, flagged: false, withdrawn: false }] }),
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
				replicates: [{ replicate_index: 0, raw_value: 120, flagged: false, withdrawn: false }],
			}),
		];
		expect(prefillFromVisit(both, docCells).doc).toEqual([120]);
	});
});
