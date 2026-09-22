import { expect, test } from '@playwright/test';
import { BASE_PATH, signIn } from './portal';
import { seedComputedVisit } from './computedVisit';
import { sheetCell, typeInto } from './sheet';

// Scenario: a scientist corrects an input in the visits table and the calculation that reads it is
// queued by the save. The table is still open in front of them.
//
// Expected behaviour: the output cell holds the recomputed number without the page being reloaded.
// The chain runs as a tracked job, so the value arrives after the save's response, and a table that
// reads the visit once is showing the old number.

const ENTERED = 10;
const CORRECTED = 15;

test('a corrected input shows its recomputed output without a reload', async ({ page, request }) => {
	const { siteId, inputName, outputName } = await seedComputedVisit(request, 't102', ENTERED);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('1 visit', { exact: true })).toBeVisible();

	// The output has its own column, holding what the calculation wrote.
	const output = sheetCell(page, new RegExp(`^${outputName} at`));
	await expect(output).toHaveText(new RegExp(`^${ENTERED * 2}\\b`));

	// The input is corrected in place. The output's column is a calculation's, so it takes no
	// keystroke and stays a read-only cell.
	const cell = sheetCell(page, new RegExp(`^${inputName} at`));
	await expect(cell).toHaveText(String(ENTERED));
	await typeInto(page, new RegExp(`^${inputName} at`), String(CORRECTED));

	const save = page.getByRole('button', { name: /^Save \d+ value/ });
	await save.click();
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(dialog).toBeHidden();

	// Nothing is reloaded: the table is the same page it was, with the recomputed output in it.
	await expect(cell).toHaveText(String(CORRECTED));
	await expect(output).toHaveText(new RegExp(`^${CORRECTED * 2}\\b`), { timeout: 30_000 });
});
