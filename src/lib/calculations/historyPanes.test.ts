import { describe, expect, it } from 'vitest';

import { historyPanes, openPane } from './historyPanes';

describe('historyPanes', () => {
	it('offers only the panes holding anything, in a fixed order', () => {
		const panes = historyPanes({ runs: 0, ledger: 2, reference: 0, versions: 3 });
		expect(panes.map((p) => p.key)).toEqual(['ledger', 'versions']);
	});

	it('offers nothing on a calculation with no history', () => {
		expect(historyPanes({ runs: 0, ledger: 0, reference: 0, versions: 0 })).toEqual([]);
	});
});

describe('openPane', () => {
	const panes = historyPanes({ runs: 1, ledger: 0, reference: 0, versions: 1 });

	it('keeps the pane chosen', () => {
		expect(openPane(panes, 'versions')).toBe('versions');
	});

	it('falls back to the first pane when the one chosen is empty or none was', () => {
		expect(openPane(panes, 'ledger')).toBe('runs');
		expect(openPane(panes, null)).toBe('runs');
		expect(openPane([], 'runs')).toBeNull();
	});
});
