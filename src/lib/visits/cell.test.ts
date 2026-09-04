import { describe, expect, it } from 'vitest';
import { visitCellMarker } from './cell';
import type { VisitCell } from '$api/service';

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
