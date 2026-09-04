// A minimal .xlsx writer: one sheet, inline strings, numbers stored as numbers, zip entries
// stored uncompressed. Enough for a template download without a spreadsheet dependency.

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

export function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff;
	for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function escapeXml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function cell(v: string): string {
	if (v === '') return '<c/>';
	if (/^-?\d+(\.\d+)?$/.test(v)) return `<c><v>${v}</v></c>`;
	return `<c t="inlineStr"><is><t>${escapeXml(v)}</t></is></c>`;
}

function sheetXml(headers: string[], rows: string[][]): string {
	const all = [headers, ...rows];
	const body = all.map((r) => `<row>${r.map(cell).join('')}</row>`).join('');
	return (
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
		'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
		`<sheetData>${body}</sheetData></worksheet>`
	);
}

function workbookParts(sheetName: string, headers: string[], rows: string[][]): [string, string][] {
	return [
		[
			'[Content_Types].xml',
			'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
				'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
				'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
				'<Default Extension="xml" ContentType="application/xml"/>' +
				'<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
				'<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
				'</Types>',
		],
		[
			'_rels/.rels',
			'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
				'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
				'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
				'</Relationships>',
		],
		[
			'xl/workbook.xml',
			'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
				'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
				`<sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
		],
		[
			'xl/_rels/workbook.xml.rels',
			'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
				'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
				'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
				'</Relationships>',
		],
		['xl/worksheets/sheet1.xml', sheetXml(headers, rows)],
	];
}

type Entry = { name: Uint8Array; data: Uint8Array; crc: number; offset: number };

function u16(v: number): number[] {
	return [v & 0xff, (v >>> 8) & 0xff];
}

function u32(v: number): number[] {
	return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

// Zip container with every entry stored (method 0); DOS time fields are left at zero.
function zipStored(parts: [string, string][]): Uint8Array<ArrayBuffer> {
	const enc = new TextEncoder();
	const chunks: number[] = [];
	const entries: Entry[] = [];
	for (const [path, content] of parts) {
		const name = enc.encode(path);
		const data = enc.encode(content);
		const crc = crc32(data);
		entries.push({ name, data, crc, offset: chunks.length });
		chunks.push(
			...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
			...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0),
			...name, ...data,
		);
	}
	const cdStart = chunks.length;
	for (const e of entries) {
		chunks.push(
			...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
			...u32(e.crc), ...u32(e.data.length), ...u32(e.data.length), ...u16(e.name.length),
			...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(e.offset), ...e.name,
		);
	}
	const cdSize = chunks.length - cdStart;
	chunks.push(
		...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length),
		...u32(cdSize), ...u32(cdStart), ...u16(0),
	);
	const out = new Uint8Array(new ArrayBuffer(chunks.length));
	out.set(chunks);
	return out;
}

export function buildXlsx(sheetName: string, headers: string[], rows: string[][]): Uint8Array<ArrayBuffer> {
	return zipStored(workbookParts(sheetName, headers, rows));
}
