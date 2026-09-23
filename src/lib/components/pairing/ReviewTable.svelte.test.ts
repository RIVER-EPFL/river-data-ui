import { createRawSnippet } from 'svelte';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';

import ReviewTable, { REVIEW_ROWS_PER_PAGE } from './ReviewTable.svelte';

type Row = { id: string };

function rows(n: number): Row[] {
	return Array.from({ length: n }, (_, i) => ({ id: `row-${i + 1}` }));
}

const name = createRawSnippet((row: () => Row) => ({ render: () => `<span>${row().id}</span>` }));

function mount(data: Row[]) {
	return render(ReviewTable<Row>, {
		rows: data,
		key: (r: Row) => r.id,
		noun: ['row', 'rows'],
		columns: [{ label: 'Name', cell: name }],
		searchText: (r: Row) => r.id,
		empty: 'Nothing here',
	});
}

describe('review table paging', () => {
	it('shows the total when every row fits on one page', () => {
		mount(rows(3));
		expect(screen.getByText('3 total')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
	});

	it('numbers pages from one and turns to the next', async () => {
		mount(rows(REVIEW_ROWS_PER_PAGE + 5));
		expect(screen.getByText('1 / 2')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		expect(screen.getByText('2 / 2')).toBeTruthy();
		expect(screen.getByText(`row-${REVIEW_ROWS_PER_PAGE + 1}`)).toBeTruthy();
		expect(screen.queryByText('row-1')).toBeNull();
	});
});
