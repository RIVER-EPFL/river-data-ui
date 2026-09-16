import { describe, expect, it } from 'vitest';
import { curveReachLine } from './curveReach';

describe('curveReachLine', () => {
	it('names the parameter, the station count and the period', () => {
		expect(
			curveReachLine({
				corrected_parameters: ['DOC'],
				corrected_sites: ['FP1', 'FP2', 'FP3', 'FP4', 'FP5', 'FP6'],
				first_corrected: '2023-04-12T08:00:00Z',
				last_corrected: '2024-01-20T08:00:00Z',
				reading_count: 40,
			}),
		).toBe('corrects DOC at 6 stations, Apr 2023 to Jan 2024');
	});

	it('names one station by name and one month once', () => {
		expect(
			curveReachLine({
				corrected_parameters: ['DOC', 'TN'],
				corrected_sites: ['FP1'],
				first_corrected: '2023-04-01T00:00:00Z',
				last_corrected: '2023-04-30T23:00:00Z',
				reading_count: 2,
			}),
		).toBe('corrects DOC and TN at FP1, Apr 2023');
	});

	it('names only the period when no stream of this plan names the curve', () => {
		expect(
			curveReachLine({
				corrected_parameters: [],
				corrected_sites: [],
				first_corrected: '2022-12-01T08:00:00Z',
				last_corrected: '2023-02-01T08:00:00Z',
				reading_count: 3,
			}),
		).toBe('corrects readings outside this plan, Dec 2022 to Feb 2023');
	});

	it('says a curve no reading names corrects nothing yet', () => {
		expect(
			curveReachLine({
				corrected_parameters: [],
				corrected_sites: [],
				first_corrected: null,
				last_corrected: null,
				reading_count: 0,
			}),
		).toBe('corrects no readings yet');
	});
});
