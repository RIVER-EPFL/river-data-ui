import { describe, expect, it } from 'vitest';
import { detectWideFile } from './wideFile';

const loggerRows = [
	{ DateTime: '2026-01-15 10:00:00', DOuM: '250', WaterTempdegC: '12.0', TurbNTU: '' },
	{ DateTime: '2026-01-15 10:10:00', DOuM: '300', WaterTempdegC: '12.5', TurbNTU: '4.1' },
];

describe('detectWideFile', () => {
	it('reads a logger export as a timestamp column plus one column per channel', () => {
		const wide = detectWideFile(['DateTime', 'DOuM', 'WaterTempdegC', 'TurbNTU'], loggerRows);
		expect(wide).toEqual({
			timeColumn: 'DateTime',
			channels: ['DOuM', 'WaterTempdegC', 'TurbNTU'],
		});
	});

	it('declines the long format this page already maps', () => {
		const rows = [{ time: '2026-01-15 10:00:00', site: 'Verbier', parameter: 'Depth', value: '12.4' }];
		expect(detectWideFile(['time', 'site', 'parameter', 'value'], rows)).toBeNull();
	});

	it('declines a file with no timestamp column', () => {
		expect(detectWideFile(['DOuM', 'WaterTempdegC'], [{ DOuM: '250', WaterTempdegC: '12' }])).toBeNull();
	});

	it('declines a single channel, which the long path maps as one series', () => {
		const rows = [{ timestamp: '2026-01-15 10:00:00', DOuM: '250', note: 'clear' }];
		expect(detectWideFile(['timestamp', 'DOuM', 'note'], rows)).toBeNull();
	});

	it('does not count an all-blank column as a channel', () => {
		const rows = [
			{ Date: '2026-01-15', DOuM: '250', spare: '' },
			{ Date: '2026-01-16', DOuM: '260', spare: '' },
		];
		expect(detectWideFile(['Date', 'DOuM', 'spare'], rows)).toBeNull();
	});

	it('accepts a channel whose rows are partly blank', () => {
		const wide = detectWideFile(['Date', 'DOuM', 'TurbNTU'], [
			{ Date: '2026-01-15', DOuM: '250', TurbNTU: '' },
			{ Date: '2026-01-16', DOuM: '260', TurbNTU: '4.1' },
		]);
		expect(wide?.channels).toEqual(['DOuM', 'TurbNTU']);
	});

	it('matches the timestamp header whatever its case and spacing', () => {
		const wide = detectWideFile(['Date Time', 'DOuM', 'TurbNTU'], [
			{ 'Date Time': '2026-01-15 10:00:00', DOuM: '250', TurbNTU: '4.1' },
		]);
		expect(wide?.timeColumn).toBe('Date Time');
	});

	it('reads an empty file as not wide', () => {
		expect(detectWideFile([], [])).toBeNull();
	});
});
