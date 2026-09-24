import { describe, expect, it } from 'vitest';

import type { EditOptionKind, InspectedRow } from '$api/service';
import {
	EDIT_METHODS,
	commonOptions,
	fieldLabel,
	isDirect,
	isRoute,
	movedFields,
	needsTarget,
	needsValue,
	outputSlots,
	overrideBody,
	previewIsEmpty,
	selectionRoute,
} from './edits';

function row(options: EditOptionKind[], hasToolRun = false, detached = false): InspectedRow {
	return {
		stream_id: 'stream',
		time: '2026-07-14T09:00:00Z',
		replicate_index: 0,
		raw_value: 1,
		provenance: {
			has_tool_run: hasToolRun,
			slot_detached: detached,
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

	it('is detached where the slot is off its calculation, whatever produced the value', () => {
		expect(selectionRoute([row(['return', 'value_correction'], true, true)])).toBe('detached');
		expect(selectionRoute([row(['return', 'value_correction'], true, true), row(['reopen_run'], true)])).toBe(
			'mixed',
		);
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

describe('the options that do not go through the edits route', () => {
	it('sends a deployment or a calibration edit to its own editor', () => {
		expect(isRoute('edit_deployment')).toBe(true);
		expect(isRoute('edit_calibration')).toBe(true);
		expect(isRoute('value_correction')).toBe(false);
	});

	it('records a detach and a return through their own routes, never previewed as an edit', () => {
		expect(isDirect('detach')).toBe(true);
		expect(isDirect('return')).toBe(true);
		expect(isDirect('override')).toBe(true);
		expect(isDirect('flag')).toBe(false);
	});
});

describe('overrideBody', () => {
	const at = {
		site_id: 's',
		parameter_id: 'p',
		time: '2026-07-14T09:00:00Z',
		replicate_index: 1,
	} as InspectedRow;

	it('names the one replicate it replaces, with the typed number', () => {
		expect(overrideBody(at, '340', 'field log')).toEqual({
			site_id: 's',
			parameter_id: 'p',
			time: '2026-07-14T09:00:00Z',
			replicate_index: 1,
			value: 340,
			reason: 'field log',
		});
	});

	it('is nothing until the value is a number', () => {
		expect(overrideBody(at, '', '')).toBeNull();
		expect(overrideBody(at, 'abc', '')).toBeNull();
	});

	it('is nothing for a row paired to no slot', () => {
		expect(overrideBody({ ...at, site_id: undefined }, '1', '')).toBeNull();
	});
});

describe('outputSlots', () => {
	const at = (site: string | undefined, parameter: string | undefined, time: string) =>
		({ site_id: site, parameter_id: parameter, time }) as InspectedRow;

	it('names each slot instant once, however many replicates it holds', () => {
		expect(
			outputSlots([
				at('s', 'p', '2026-07-14T09:00:00Z'),
				at('s', 'p', '2026-07-14T09:00:00Z'),
				at('s', 'q', '2026-07-14T09:00:00Z'),
			]),
		).toEqual([
			{ site_id: 's', parameter_id: 'p', time: '2026-07-14T09:00:00Z' },
			{ site_id: 's', parameter_id: 'q', time: '2026-07-14T09:00:00Z' },
		]);
	});

	it('leaves out a row paired to no slot', () => {
		expect(outputSlots([at(undefined, undefined, '2026-07-14T09:00:00Z')])).toEqual([]);
	});
});
