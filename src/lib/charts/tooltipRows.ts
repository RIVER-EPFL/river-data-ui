/// How many series the shared tooltip lists at once. Every chart on a site page registers with the
/// cursor group, and a site can draw ninety of them, so the box is bounded here rather than by how
/// many parameters the site happens to hold.

export const TOOLTIP_ROW_LIMIT = 12;

/// The rows the tooltip draws, and how many it left out. The chart under the cursor is always
/// among them: it is the one being read. The rest keep the order they registered in, so a series
/// does not move between two hovers.
export function capRows<T extends { detailed: boolean }>(
	rows: T[],
	limit: number = TOOLTIP_ROW_LIMIT
): { shown: T[]; hidden: number } {
	if (limit <= 0 || rows.length <= limit) return { shown: rows, hidden: 0 };
	const kept = new Set<number>();
	const detailed = rows.findIndex((r) => r.detailed);
	if (detailed >= 0) kept.add(detailed);
	for (let i = 0; i < rows.length && kept.size < limit; i++) kept.add(i);
	return { shown: rows.filter((_, i) => kept.has(i)), hidden: rows.length - kept.size };
}
