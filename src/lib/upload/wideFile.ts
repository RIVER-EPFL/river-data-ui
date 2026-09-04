// A logger export is wide: one timestamp column and one column per channel. This page takes the
// long form (one row per reading), so a wide file has to be routed to the per-site import rather
// than mapped here.

const TIME_HEADERS = ['time', 'datetime', 'date_time', 'timestamp', 'date'];

// Headers a long-format file carries. Their presence means the file is already the shape this
// page maps, whatever else it holds.
const LONG_HEADERS = ['parameter', 'parameter_name', 'value', 'reading', 'measurement'];

function normalise(header: string): string {
	return header.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function isTimeHeader(header: string): boolean {
	return TIME_HEADERS.includes(normalise(header));
}

function isNumeric(cell: string | undefined): boolean {
	if (cell === undefined) return false;
	const t = cell.trim();
	if (t === '') return false;
	return Number.isFinite(Number(t.replace(',', '.')));
}

// A column counts as a channel when the rows that carry a value carry a number. A gap-heavy
// logger column is still a channel, an all-blank one is not.
function isChannel(rows: Record<string, string>[], header: string): boolean {
	let filled = 0;
	let numeric = 0;
	for (const row of rows) {
		const cell = row[header];
		if (cell === undefined || cell.trim() === '') continue;
		filled += 1;
		if (isNumeric(cell)) numeric += 1;
	}
	return filled > 0 && numeric === filled;
}

export interface WideFile {
	timeColumn: string;
	channels: string[];
}

// Returns the wide reading of the file, or null when it is not one: no timestamp column, a
// long-format header present, or fewer than two numeric channels beside the timestamp.
export function detectWideFile(
	headers: string[],
	rows: Record<string, string>[],
): WideFile | null {
	const timeColumn = headers.find(isTimeHeader);
	if (!timeColumn) return null;
	if (headers.some((h) => LONG_HEADERS.includes(normalise(h)))) return null;
	const channels = headers.filter((h) => h !== timeColumn && isChannel(rows, h));
	return channels.length >= 2 ? { timeColumn, channels } : null;
}
