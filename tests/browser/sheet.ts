import type { Locator, Page } from '@playwright/test';

// The Visits table is a Handsontable grid, which draws its frozen columns and its header in
// overlay copies of the table. Each helper reads the copy a person sees.

/** A value cell, by the label its renderer gives it: `{code} at {date}` or `{code} repeat {n} at {date}`. */
export function sheetCell(page: Page, name: RegExp): Locator {
	return page.locator('.ht_master').getByRole('gridcell', { name });
}

/**
 * The frozen date column's text for an instant: its wall clock in the reader's zone, as
 * `formatCompactInstant` prints it.
 */
export function frozenDate(instant: string | Date): string {
	const d = instant instanceof Date ? instant : new Date(instant);
	const pad = (n: number) => String(n).padStart(2, '0');
	const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	return `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** A button in the frozen date column, such as a visit's expand. */
export function frozenButton(page: Page, options: Parameters<Locator['getByRole']>[1]): Locator {
	return page.locator('.ht_clone_inline_start').getByRole('button', options);
}

/** A cell of the frozen date column, by the row it stands on, the first visit being row 0. */
export function frozenCell(page: Page, row: number): Locator {
	return page.locator('.ht_clone_inline_start tbody tr').nth(row).locator('td').first();
}

/** A button in a group's header: its toggle, or its one repeat fewer or more. */
export function headerButton(page: Page, options: Parameters<Locator['getByRole']>[1]): Locator {
	return page.locator('.ht_clone_top').getByRole('button', options);
}

/** Select a cell and type over it, as a person does in a sheet. Enter commits and moves down. */
export async function typeInto(page: Page, cell: RegExp | Locator, text: string) {
	await (cell instanceof RegExp ? sheetCell(page, cell) : cell).click();
	await page.keyboard.type(text);
	await page.keyboard.press('Enter');
}

/** A cell of a calculation's tables, by the row it belongs to. Column 0 is the label. */
export function calculationCell(page: Page, row: string, column = 1): Locator {
	return page.locator(`.ht_master td[data-sheet-row="${row}"][data-sheet-column="${column}"]`);
}
