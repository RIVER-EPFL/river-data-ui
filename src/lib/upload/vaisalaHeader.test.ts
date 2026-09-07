import { describe, expect, it } from 'vitest';
import { detectTimezone, readVaisalaFile } from './vaisalaHeader';

const HEADER = 'Time zone: W. Europe Standard Time (UTC+01:00)';
const ROWS = 'Time\tMDepthmm\n2026-01-15 10:00:00\t412\n2026-01-15 10:10:00\t415';

function utf16le(text: string, name: string): File {
	const bytes = new Uint8Array(2 + text.length * 2);
	bytes[0] = 0xff;
	bytes[1] = 0xfe;
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		bytes[2 + i * 2] = code & 0xff;
		bytes[3 + i * 2] = code >> 8;
	}
	return new File([bytes], name);
}

describe('detectTimezone', () => {
	it('reads the offset and the label the export names', () => {
		expect(detectTimezone(HEADER)).toEqual({
			offsetHours: 1,
			label: 'UTC+01:00',
		});
	});

	it('keeps the minutes on a negative offset', () => {
		expect(detectTimezone('Time zone: Newfoundland (UTC-03:30)')?.offsetHours).toBe(-3.5);
	});

	it('declines a line that names no timezone', () => {
		expect(detectTimezone('Time\tMDepthmm')).toBeNull();
	});
});

describe('readVaisalaFile', () => {
	it('strips the metadata line so the header row is the header row', async () => {
		const read = await readVaisalaFile(utf16le(`${HEADER}\r\n${ROWS}`, 'export.txt'));
		expect(read.text.split('\n')[0]).toBe('Time\tMDepthmm');
		expect(read.timezone?.offsetHours).toBe(1);
		expect(read.tsv).toBe(true);
	});

	it('reads a UTF-8 file with no metadata line unchanged', async () => {
		const read = await readVaisalaFile(new File(['time,value\n2026-01-15T10:00:00Z,412'], 'a.csv'));
		expect(read.text).toBe('time,value\n2026-01-15T10:00:00Z,412');
		expect(read.timezone).toBeNull();
		expect(read.tsv).toBe(false);
	});

	it('reads a .tsv extension as tab-separated with no metadata line', async () => {
		const read = await readVaisalaFile(new File([ROWS], 'export.tsv'));
		expect(read.tsv).toBe(true);
		expect(read.text).toBe(ROWS);
	});
});
