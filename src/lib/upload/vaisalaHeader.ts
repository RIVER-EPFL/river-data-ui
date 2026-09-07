// A Vaisala export is a UTF-16 LE tab-separated file whose first line is a metadata line naming
// the timezone the timestamps are written in. Both upload paths read that line, so they read it
// here.

export interface VaisalaTimezone {
	offsetHours: number;
	label: string;
}

// Decode by byte-order mark: UTF-16 LE for a Vaisala export, UTF-8 for everything else.
export function decodeWithBom(bytes: ArrayBuffer): string {
	const head = new Uint8Array(bytes);
	if (head.length >= 2 && head[0] === 0xff && head[1] === 0xfe) {
		return new TextDecoder('utf-16le').decode(bytes);
	}
	return new TextDecoder('utf-8').decode(bytes);
}

export async function readTextWithBom(file: File): Promise<string> {
	return decodeWithBom(await file.arrayBuffer());
}

export function detectTimezone(firstLine: string): VaisalaTimezone | null {
	const match = firstLine.match(/Time zone:.*\(UTC([+-]\d{2}):(\d{2})\)/i);
	if (!match) return null;
	const hours = parseInt(match[1], 10);
	const minutes = parseInt(match[2], 10);
	const offsetHours = hours + (hours < 0 ? -1 : 1) * (minutes / 60);
	const sign = offsetHours >= 0 ? '+' : '';
	return {
		offsetHours,
		label: firstLine.match(/\(([^)]+)\)/)?.[1] ?? `UTC${sign}${offsetHours}`,
	};
}

export interface VaisalaFile {
	// The file with any metadata line removed, ready to parse.
	text: string;
	timezone: VaisalaTimezone | null;
	tsv: boolean;
}

export async function readVaisalaFile(file: File): Promise<VaisalaFile> {
	const text = await readTextWithBom(file);
	const lines = text.split(/\r?\n/);
	const timezone = detectTimezone(lines[0] ?? '');
	return {
		text: timezone ? lines.slice(1).join('\n') : text,
		timezone,
		tsv: file.name.endsWith('.tsv') || timezone !== null,
	};
}
