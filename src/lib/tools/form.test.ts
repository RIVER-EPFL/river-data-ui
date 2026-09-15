import { describe, expect, it } from 'vitest';

import { openingFromRun } from './form';

// Scenario: a form reopened on a stored run. Expected behaviour: it opens on everything the run
// used, which is its inputs and the curves that filled its slots (Q192).
describe('the prefill a reopened run supplies', () => {
	it('puts each curve under the slot that took it, beside the inputs', () => {
		const opening = openingFromRun({
			body: { doc: [1, 2], site_id: 'site-1' },
			curves: [
				{
					name: 'corr',
					curve: { slope: 3, intercept: 0.5, standard_curve_id: 'curve-9', label: 'Plate 3' },
				},
			],
		});
		expect(opening.doc).toEqual([1, 2]);
		expect(opening.site_id).toBe('site-1');
		expect(opening.corr).toEqual({
			slope: 3,
			intercept: 0.5,
			standard_curve_id: 'curve-9',
			label: 'Plate 3',
		});
	});

	it('is the inputs alone for a run that used no curve', () => {
		expect(openingFromRun({ body: { doc: [1] }, curves: [] })).toEqual({ doc: [1] });
		expect(openingFromRun({ body: { doc: [1] } })).toEqual({ doc: [1] });
	});

	it('skips a snapshot naming no slot rather than opening an unnamed one', () => {
		const opening = openingFromRun({
			body: {},
			curves: [{ curve: { slope: 1, intercept: 0 } }, { name: 'corr' }],
		});
		expect(opening).toEqual({});
	});
});
