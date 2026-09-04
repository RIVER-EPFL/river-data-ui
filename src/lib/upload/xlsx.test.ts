import { describe, expect, it } from 'vitest';
import { buildXlsx, crc32 } from './xlsx';

function ascii(bytes: Uint8Array): string {
	return new TextDecoder('latin1').decode(bytes);
}

describe('crc32', () => {
	it('matches the reference value for the check string', () => {
		// The IEEE CRC-32 of "123456789".
		expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
	});
});

describe('buildXlsx', () => {
	const bytes = buildXlsx('readings', ['time', 'site', 'value'], [['2026-01-15 10:30:00', 'Verbier', '12.4']]);
	const text = ascii(bytes);

	it('is a zip archive whose last record is the end-of-central-directory', () => {
		expect(text.startsWith('PK\x03\x04')).toBe(true);
		expect(text.lastIndexOf('PK\x05\x06')).toBe(bytes.length - 22);
	});

	it('holds the five parts a workbook needs', () => {
		for (const part of [
			'[Content_Types].xml',
			'_rels/.rels',
			'xl/workbook.xml',
			'xl/_rels/workbook.xml.rels',
			'xl/worksheets/sheet1.xml',
		]) {
			expect(text).toContain(part);
		}
		const entries = new DataView(bytes.buffer, bytes.length - 22).getUint16(10, true);
		expect(entries).toBe(5);
	});

	it('writes text cells as inline strings and numeric cells as numbers', () => {
		expect(text).toContain('<c t="inlineStr"><is><t>Verbier</t></is></c>');
		expect(text).toContain('<c><v>12.4</v></c>');
		expect(text).toContain('<is><t>2026-01-15 10:30:00</t></is>');
	});

	it('escapes markup in cell text', () => {
		const t = ascii(buildXlsx('s', ['a'], [['<b> & "c"']]));
		expect(t).toContain('<t>&lt;b&gt; &amp; "c"</t>');
	});
});
