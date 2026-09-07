import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import CrudListHarness from './CrudListHarness.test.svelte';
import type { Column } from './CrudList.svelte';

const COLUMNS: Column[] = [
	{ key: 'name', label: 'Name' },
	{ key: 'count', label: 'Count' },
];

function loader(rows: Record<string, unknown>[] = [{ name: 'Martigny', count: 3 }]) {
	return vi.fn().mockResolvedValue({ data: rows, total: rows.length });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('CrudList', () => {
	it('asks the loader for the first page under the declared sort', async () => {
		const load = loader();
		render(CrudListHarness, { load, columns: COLUMNS, defaultSort: ['name', 'ASC'] });
		await settle();
		expect(load).toHaveBeenCalledWith({
			page: 1,
			perPage: 25,
			sort: ['name', 'ASC'],
			filter: {},
		});
	});

	it('flips the order on a second click of the same column and returns to page one', async () => {
		const load = loader();
		render(CrudListHarness, { load, columns: COLUMNS, defaultSort: ['name', 'ASC'] });
		await settle();
		const header = () => screen.getByRole('columnheader', { name: /Count/ });
		await fireEvent.click(header());
		await settle();
		expect(load.mock.calls[1][0].sort).toEqual(['count', 'ASC']);
		await fireEvent.click(header());
		await settle();
		expect(load.mock.calls[2][0].sort).toEqual(['count', 'DESC']);
		expect(load.mock.calls[2][0].page).toBe(1);
	});

	it('renders the loaded rows', async () => {
		render(CrudListHarness, { load: loader(), columns: COLUMNS });
		await settle();
		expect(screen.getByText('Martigny')).toBeTruthy();
		expect(screen.getByText('3')).toBeTruthy();
	});

	it('lets a cell snippet take over one column and leaves the rest as text', async () => {
		render(CrudListHarness, { load: loader(), columns: COLUMNS, withCell: true });
		await settle();
		expect(screen.getByText('Martigny').tagName).toBe('STRONG');
		expect(screen.getByText('3').tagName).toBe('TD');
	});

	it('adds one trailing column when actions are given', async () => {
		const { container } = render(CrudListHarness, {
			load: loader(),
			columns: COLUMNS,
			withActions: true,
		});
		await settle();
		expect(container.querySelectorAll('thead th')).toHaveLength(3);
		expect(screen.getByText('Edit Martigny')).toBeTruthy();
	});

	it('renders an expansion row under each row, spanning the table', async () => {
		const { container } = render(CrudListHarness, {
			load: loader(),
			columns: COLUMNS,
			withDetail: true,
			withActions: true,
		});
		await settle();
		const detail = screen.getByText('Detail for Martigny');
		expect(detail.getAttribute('colspan')).toBe('3');
		expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
	});

	it('replaces the table with the empty snippet when there is nothing to show', async () => {
		const { container } = render(CrudListHarness, {
			load: loader([]),
			columns: COLUMNS,
			withEmpty: true,
		});
		await settle();
		expect(screen.getByText('Nothing here yet')).toBeTruthy();
		expect(container.querySelector('table')).toBeNull();
	});

	it('spans the empty row across every column, actions included', async () => {
		const { container } = render(CrudListHarness, {
			load: loader([]),
			columns: COLUMNS,
			withActions: true,
		});
		await settle();
		expect(container.querySelector('tbody td')?.getAttribute('colspan')).toBe('3');
	});
});
