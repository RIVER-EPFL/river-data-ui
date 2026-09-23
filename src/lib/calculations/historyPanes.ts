/// The tabs under a calculation's sheet: what it has already done and where it came from.

export type HistoryKey = 'runs' | 'ledger' | 'reference' | 'versions';

export interface HistoryPane {
	key: HistoryKey;
	label: string;
}

const PANES: HistoryPane[] = [
	{ key: 'runs', label: 'Runs at this visit' },
	{ key: 'ledger', label: 'Computed on a stream' },
	{ key: 'reference', label: 'Portal reference' },
	{ key: 'versions', label: 'Versions' },
];

/** The panes holding anything, in a fixed order. */
export function historyPanes(counts: Record<HistoryKey, number>): HistoryPane[] {
	return PANES.filter((p) => counts[p.key] > 0);
}

/** The pane shown: the one chosen while it still holds anything, else the first. */
export function openPane(panes: HistoryPane[], chosen: HistoryKey | null): HistoryKey | null {
	if (chosen && panes.some((p) => p.key === chosen)) return chosen;
	return panes[0]?.key ?? null;
}
