import { afterEach, describe, expect, it, vi } from 'vitest';
import { curveReachLine } from './curveReach';

describe('curveReachLine', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('names the parameter, the station count and the period', () => {
		expect(
			curveReachLine({
				corrected_parameters: ['DOC'],
				corrected_sites: ['FP1', 'FP2', 'FP3', 'FP4', 'FP5', 'FP6'],
				first_corrected: '2023-04-12T08:00:00Z',
				last_corrected: '2024-01-20T08:00:00Z',
				reading_count: 40,
			}, 'UTC'),
		).toBe('corrects DOC at 6 stations, Apr 2023 to Jan 2024');
	});

	it('names the month the period reads as in the zone the preference names', () => {
		const reach = {
			corrected_parameters: ['DOC'],
			corrected_sites: ['FP1'],
			// 23:30 UTC on 30 April is already May in Zurich.
			first_corrected: '2023-04-30T23:30:00Z',
			last_corrected: '2023-04-30T23:30:00Z',
			reading_count: 1,
		};
		expect(curveReachLine(reach, 'UTC')).toBe('corrects DOC at FP1, Apr 2023');
		expect(curveReachLine(reach, 'Europe/Zurich')).toBe('corrects DOC at FP1, May 2023');
	});

	it('names the month in the browser locale, as every other date the UI prints does', () => {
		const toLocaleString = Date.prototype.toLocaleString;
		vi.spyOn(Date.prototype, 'toLocaleString').mockImplementation(function (this: Date, locales, options) {
			return toLocaleString.call(this, locales ?? 'fr-CH', options);
		});
		expect(
			curveReachLine({
				corrected_parameters: ['DOC'],
				corrected_sites: ['FP1'],
				first_corrected: '2023-05-12T08:00:00Z',
				last_corrected: '2023-05-20T08:00:00Z',
				reading_count: 2,
			}, 'UTC'),
		).toBe('corrects DOC at FP1, mai 2023');
	});

	it('names one station by name and one month once', () => {
		expect(
			curveReachLine({
				corrected_parameters: ['DOC', 'TN'],
				corrected_sites: ['FP1'],
				first_corrected: '2023-04-01T00:00:00Z',
				last_corrected: '2023-04-30T23:00:00Z',
				reading_count: 2,
			}, 'UTC'),
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
			}, 'UTC'),
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
			}, 'UTC'),
		).toBe('corrects no readings yet');
	});
});
