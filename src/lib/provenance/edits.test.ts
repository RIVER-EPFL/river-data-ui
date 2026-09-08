import { describe, expect, it } from 'vitest';

import type { EditOptionKind, InspectedRow } from '$api/service';
import {
	EDIT_METHODS,
	commonOptions,
	fieldLabel,
	movedFields,
	needsTarget,
	needsValue,
	previewIsEmpty,
	selectionRoute,
} from './edits';

function row(options: EditOptionKind[], hasToolRun = false): InspectedRow {
	return {
		stream_id: 'stream',
		time: '2026-07-14T09:00:00Z',
		replicate_index: 0,
		raw_value: 1,
		provenance: {
			has_tool_run: hasToolRun,
			classification: 'manual',
			has_standard_curve: false,
			has_calibration: false,
			has_deployment: false,
			is_flagged: false,
			withdrawn: false,
			unverified: false,
		},
		options,
	};
}

describe('edit methods', () => {
	it('says what every option changes and what it leaves alone', () => {
		for (const [kind, method] of Object.entries(EDIT_METHODS)) {
			expect(method.label, kind).toBeTruthy();
			expect(method.changes.length, kind).toBeGreaterThan(20);
			expect(method.leaves.length, kind).toBeGreaterThan(10);
		}
	});

	it('asks for a value only where one is carried, and a target only where one is named', () => {
		expect(needsValue('value_correction')).toBe(true);
		for (const kind of ['flag', 'withdraw', 'curve', 'verify'] as EditOptionKind[]) {
			expect(needsValue(kind), kind).toBe(false);
		}
		expect(needsTarget('curve')).toBe(true);
		// Attribution is corrected on the record that decides it, so no edit names an instrument
		// or a calibration to stamp on the row (Q117).
		for (const kind of [
			'value_correction',
			'edit_deployment',
			'edit_calibration',
		] as EditOptionKind[]) {
			expect(needsTarget(kind), kind).toBe(false);
		}
	});
});

describe('the route a selection takes', () => {
	it('is the tool when every row names a run and manual when none does', () => {
		expect(selectionRoute([])).toBe('empty');
		expect(selectionRoute([row(['reopen_run'], true)])).toBe('tool');
		expect(selectionRoute([row(['value_correction'])])).toBe('manual');
		expect(selectionRoute([row(['reopen_run'], true), row(['value_correction'])])).toBe('mixed');
	});

	it('offers only what every selected row permits', () => {
		const rows = [
			row(['value_correction', 'flag', 'withdraw']),
			row(['value_correction', 'unflag', 'withdraw']),
		];
		expect(commonOptions(rows)).toEqual(['value_correction', 'withdraw']);
		expect(commonOptions([])).toEqual([]);
	});
});

describe('what the preview shows', () => {
	it('lists only the fields that moved, named for a reader', () => {
		const moved = movedFields(
			{ raw_value: 10, is_flagged: false, flag_reason: null },
			{ raw_value: 40, is_flagged: false, flag_reason: null },
		);
		expect(moved).toEqual([{ field: 'raw_value', before: 10, after: 40 }]);
		expect(fieldLabel('raw_value')).toBe('Value');
		expect(fieldLabel('stdev')).toBe('Standard deviation');
		// An unmapped column is shown under its own name rather than hidden.
		expect(fieldLabel('sample_id')).toBe('sample_id');
	});

	it('treats an absent field and a null field as the same standing still', () => {
		expect(movedFields({ flag_reason: null }, {})).toEqual([]);
		expect(movedFields({}, { flag_reason: 'spike' })).toEqual([
			{ field: 'flag_reason', before: null, after: 'spike' },
		]);
	});

	it('says when an edit would change nothing at all', () => {
		const still = { stream_id: 's', time: 't', replicate_index: 0, before: { raw_value: 1 }, after: { raw_value: 1 } };
		expect(previewIsEmpty([still], [])).toBe(true);
		expect(
			previewIsEmpty([{ ...still, after: { raw_value: 2 } }], []),
		).toBe(false);
		// A row that stood still while its group's statistics moved is still a change.
		expect(
			previewIsEmpty([still], [{ sample_id: 'x', before: { mean: 1 }, after: { mean: 2 } }]),
		).toBe(false);
	});
});
