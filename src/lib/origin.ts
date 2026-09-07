/** Where a row came from, in one vocabulary for every list that holds imported rows. */
export type Origin = 'any' | 'manual' | 'sync' | `source:${string}`;

/** The wording every surface uses for a source system. */
export function originLabel(source: string): string {
	if (source === 'grab_sample') return 'manual entry';
	if (source === 'csv' || source === 'csv_import') return 'CSV import';
	if (source === 'api') return 'API';
	return `${source} sync`;
}

/** The source system named by an origin, or null for the origins that name none. */
export function originSource(origin: Origin): string | null {
	return origin.startsWith('source:') ? origin.slice('source:'.length) : null;
}

/**
 * The filter fragment for an origin, over the column that records it. `column` is
 * `source_system` where the entity names its source and `discovered_at` where it only carries the
 * stamp a sync leaves, which is why "from a sync" is a null test rather than a value.
 */
export function originFilter(
	origin: Origin,
	column: 'source_system' | 'discovered_at',
): Record<string, unknown> {
	const source = originSource(origin);
	if (source) return { [column]: source };
	if (origin === 'sync') return { [`${column}_neq`]: null };
	if (origin === 'manual') return { [column]: null };
	return {};
}
