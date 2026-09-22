import { describe, expect, it } from 'vitest';

import { calculationApplyPreview } from './apply';

const slot = (id: string, code: string, role: string) => ({
	parameter_id: id,
	parameter_code: code,
	role,
});

describe('calculationApplyPreview', () => {
	it('names the reads the site does not measure and refuses on them', () => {
		const preview = calculationApplyPreview(
			{
				inputs_present: [slot('1', 'DOC', 'measured')],
				inputs_missing: [slot('2', 'a254', 'measured')],
				outputs_existing: [],
				outputs_created: [slot('3', 'suva', 'output')],
			},
			(id) => (id === '2' ? 'Absorbance at 254 nm' : null),
		);
		expect(preview.applicable).toBe(false);
		expect(preview.inputsMissing.map((s) => s.name)).toEqual(['Absorbance at 254 nm']);
		expect(preview.outputsAdding.map((s) => s.code)).toEqual(['suva']);
	});

	it('reads as complete once every input is declared and every output exists', () => {
		const preview = calculationApplyPreview(
			{
				inputs_present: [slot('1', 'DOC', 'measured')],
				inputs_missing: [],
				outputs_existing: [slot('3', 'suva', 'output')],
				outputs_created: [],
			},
			() => null,
		);
		expect(preview.applicable).toBe(true);
		expect(preview.complete).toBe(true);
		expect(preview.outputsHeld.map((s) => s.code)).toEqual(['suva']);
	});

	it('falls back to the code when the catalog does not name the parameter', () => {
		const preview = calculationApplyPreview(
			{
				inputs_present: [],
				inputs_missing: [],
				outputs_existing: [],
				outputs_created: [slot('3', 'suva', 'output')],
			},
			() => null,
		);
		expect(preview.outputsAdding[0].name).toBe('suva');
		expect(preview.complete).toBe(false);
	});
});
