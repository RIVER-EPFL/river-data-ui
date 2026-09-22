// A field day entered as rows: each row a site and the instant it was sampled at.

export interface FieldDayRow {
	site: string;
	/** The instant, ISO-8601 in UTC, as the timestamp control resolved it. */
	when: string;
}

/** The rows repeating an earlier row's site and time, as `[first, repeat]` positions. */
export function repeatedRows(rows: FieldDayRow[]): [number, number][] {
	const repeats: [number, number][] = [];
	rows.forEach((row, i) => {
		if (!row.site || !row.when) return;
		const first = rows.findIndex((r) => r.site === row.site && r.when === row.when);
		if (first < i) repeats.push([first, i]);
	});
	return repeats;
}

/** The row Add another starts: the last row's instant, and the fixed site if there is one. */
export function nextRow(last: FieldDayRow, fixedSite: string | null): FieldDayRow {
	return { site: fixedSite ?? '', when: last.when };
}
