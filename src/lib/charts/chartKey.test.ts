import { describe, it, expect } from 'vitest';
import { chartKeyEntries } from './chartKey';

describe('chartKeyEntries', () => {
	it('names nothing a render did not draw', () => {
		expect(chartKeyEntries({ line: true })).toEqual([
			{ mark: 'line', label: 'Continuous sensor series' },
		]);
	});

	it('names the bar as the sample standard deviation, in the slot\'s units', () => {
		const [entry] = chartKeyEntries({ sdBar: true, units: 'ppb' });
		expect(entry.label).toBe('±1 sample standard deviation, ppb');
	});

	it('names each annotation category present, with the colour it is painted', () => {
		const entries = chartKeyEntries({ annotationCategories: ['maintenance', 'audit'] });
		expect(entries.map((e) => e.label)).toEqual([
			'Annotation: maintenance',
			'Annotation: audit',
		]);
		expect(entries[0].color).not.toBe(entries[1].color);
	});

	it('lists the three spot states separately so the diamond is never ambiguous', () => {
		const marks = chartKeyEntries({
			spot: true,
			spotAgreed: true,
			spotSingle: true,
			sdBar: true,
		}).map((e) => e.mark);
		expect(marks).toEqual(['spot', 'spotAgreed', 'spotSingle', 'sdBar']);
	});
});

describe('the retracted mark', () => {
	it('is named only when a retracted instant is actually drawn', () => {
		expect(chartKeyEntries({ spot: true }).map((e) => e.mark)).not.toContain('withdrawn');
		expect(chartKeyEntries({ spot: true, withdrawn: true }).map((e) => e.mark)).toContain(
			'withdrawn'
		);
	});

	it('says the retraction is reversible, so it is not read as a deletion', () => {
		const [entry] = chartKeyEntries({ withdrawn: true });
		expect(entry.label).toContain('reversible');
	});
});

describe('the pending mark', () => {
	it('is named only when a pending entry is actually drawn', () => {
		expect(chartKeyEntries({ spot: true }).map((e) => e.mark)).not.toContain('unverified');
		expect(chartKeyEntries({ spot: true, unverified: true }).map((e) => e.mark)).toContain(
			'unverified'
		);
	});

	it('says what a pending entry is left out of, since the chart is the only place it shows', () => {
		const [entry] = chartKeyEntries({ unverified: true });
		expect(entry.label).toContain('public API');
		expect(entry.label).toContain('alarms');
	});
});
