import { expect, test } from '@playwright/test';
import { BASE_PATH, signIn } from './portal';
import { seedComputedVisit } from './computedVisit';
import { sheetCell, typeInto } from './sheet';

// Scenario: a scientist types a correction into the visits table and wants to see what it does to
// the values the calculations write, before deciding to save it.
//
// Expected behaviour: the calculated cell shows what the typed value would make it, marked as
// unsaved, while the store still holds the old number. Undo puts the old number back. Save is what
// writes the previewed one.

const ENTERED = 10;
const CORRECTED = 15;

test('a typed correction previews its calculated value, and only Save writes it', async ({
	page,
	request,
}) => {
	const visit = await seedComputedVisit(request, 't280', ENTERED);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${visit.siteId}?tab=visits`);
	await expect(page.getByText('1 visit', { exact: true })).toBeVisible();

	const input = sheetCell(page, new RegExp(`^${visit.inputName} at`));
	const output = sheetCell(page, new RegExp(`^${visit.outputName} at`));
	await expect(output).toHaveText(new RegExp(`^${ENTERED * 2}\\b`));

	await typeInto(page, input, String(CORRECTED));

	// The calculated cell follows the typing, and says it is not the stored number.
	await expect(output).toHaveText(new RegExp(`^${CORRECTED * 2}\\b`));
	await expect(output).toHaveAttribute('title', /not saved yet/);
	await expect(page.getByText(/calculated value.* shown unsaved/)).toBeVisible();
	expect(await visit.served()).toBe(ENTERED * 2);

	// Undo takes the typing back, and the calculated cell goes back to what the store holds.
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(input).toHaveText(String(ENTERED));
	await expect(output).toHaveText(new RegExp(`^${ENTERED * 2}\\b`));
	await expect(output).not.toHaveAttribute('title', /not saved yet/);

	// Typed again and saved: the previewed number is the one the store ends up holding.
	await typeInto(page, input, String(CORRECTED));
	await expect(output).toHaveText(new RegExp(`^${CORRECTED * 2}\\b`));
	await page.getByRole('button', { name: /^Save \d+ value/ }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(dialog).toBeHidden();

	await expect(output).toHaveText(new RegExp(`^${CORRECTED * 2}\\b`), { timeout: 30_000 });
	await expect(output).not.toHaveAttribute('title', /not saved yet/);
	await expect.poll(visit.served, { timeout: 30_000 }).toBe(CORRECTED * 2);
});
