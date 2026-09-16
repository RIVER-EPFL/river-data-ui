import { describe, it, expect } from 'vitest';
import { spotDispersion, spotRangeLabel, spotSampleLine } from './spotSummary';
import type { SpotPointStats } from './spotMarkers';

function replicate(value: number, extra: Partial<{ flagged: boolean; withdrawn: boolean }> = {}) {
	return {
		replicate_index: 0,
		raw_value: value,
		calibrated_value: null,
		flagged: extra.flagged ?? false,
		withdrawn: extra.withdrawn ?? false,
	};
}

function stat(over: Partial<SpotPointStats>): SpotPointStats {
	return { mean: 1, stdev: null, n: 1, ...over };
}

describe('spotDispersion', () => {
	it('calls one measurement single', () => {
		expect(spotDispersion(stat({ n: 1 }))).toBe('single');
	});

	it('separates a group whose replicates agree from one with spread', () => {
		expect(spotDispersion(stat({ n: 3, stdev: 0 }))).toBe('agreed');
		expect(spotDispersion(stat({ n: 3, stdev: null }))).toBe('agreed');
		expect(spotDispersion(stat({ n: 3, stdev: 0.4 }))).toBe('spread');
	});
});

describe('spotSampleLine', () => {
	it('names the state of a single measurement instead of printing nothing', () => {
		const line = spotSampleLine(stat({ n: 1, mean: 12.5 }), 2);
		expect(line).not.toBeNull();
		expect(line).toContain('single measurement');
	});

	it('says the replicates agreed when the sd is zero', () => {
		const line = spotSampleLine(
			stat({ n: 2, mean: 4, stdev: 0, replicates: [replicate(4), replicate(4)] }),
			1
		);
		expect(line).toBe('mean of 2: 4.0, 4.0 (replicates agree, sd 0)');
	});

	it('prints the sd and the replicates behind a group with spread', () => {
		const line = spotSampleLine(
			stat({ n: 2, mean: 4.5, stdev: 0.5, replicates: [replicate(4), replicate(5)] }),
			1
		);
		expect(line).toBe('mean of 2 ±0.5 SD: 4.0, 5.0');
	});

	it('names the replicates the mean excludes', () => {
		const line = spotSampleLine(
			stat({
				n: 2,
				mean: 4.5,
				stdev: 0.5,
				replicates: [replicate(4), replicate(5), replicate(9, { flagged: true })],
			}),
			1
		);
		expect(line).toContain('1 of 3 flagged*');
	});
});

describe('spotRangeLabel', () => {
	it('reports the observed extremes of a group', () => {
		expect(spotRangeLabel(stat({ n: 3, mean: 48.2, min: 41.2, max: 62 }), 1)).toBe(
			'range 41.2 to 62.0'
		);
	});

	it('has nothing to report for a single measurement or an unrecorded range', () => {
		expect(spotRangeLabel(stat({ n: 1, min: 4, max: 4 }), 1)).toBeNull();
		expect(spotRangeLabel(stat({ n: 3, min: null, max: null }), 1)).toBeNull();
	});

	it('names the units beside the sd it prints', () => {
		const line = spotSampleLine(
			stat({ n: 2, mean: 4.5, stdev: 0.5, replicates: [replicate(4), replicate(5)] }),
			1,
			{ units: 'ppb' }
		);
		expect(line).toContain('±0.5 ppb SD');
	});

	it('rides the sample line so the sd bar is never read as the range', () => {
		const line = spotSampleLine(
			stat({ n: 3, mean: 48.2, stdev: 11.6, min: 41.2, max: 62 }),
			1
		);
		expect(line).toContain('range 41.2 to 62.0');
	});
});
