import { expect, test } from '@playwright/test';
import { BASE_PATH, signIn } from './portal';
import { seedComputedVisit } from './computedVisit';
import { frozenCell, sheetCell, typeInto } from './sheet';

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
	await page.getByRole('button', { name: 'Check against site history' }).click();
	await page.getByRole('button', { name: /^Save \d+ value/ }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(dialog).toBeHidden();

	await expect(output).toHaveText(new RegExp(`^${CORRECTED * 2}\\b`), { timeout: 30_000 });
	await expect(output).not.toHaveAttribute('title', /not saved yet/);
	await expect.poll(visit.served, { timeout: 30_000 }).toBe(CORRECTED * 2);
});

// Scenario: someone types into the visits table and then leaves it before saving.
// Expected behaviour: leaving through the app asks first, and staying keeps what was typed; closing
// the tab raises the browser's own unload warning.
test('leaving the table with a typed value asks first, in the app and on unload', async ({
	page,
	request,
}) => {
	const visit = await seedComputedVisit(request, 't157', ENTERED);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${visit.siteId}?tab=visits`);
	const input = sheetCell(page, new RegExp(`^${visit.inputName} at`));
	await expect(input).toHaveText(String(ENTERED));
	await typeInto(page, input, String(CORRECTED));

	const asked = page.waitForEvent('dialog');
	void page.getByRole('navigation').getByRole('link', { name: 'Parameters', exact: true }).first().click();
	const prompt = await asked;
	expect(prompt.message()).toContain('not saved yet');
	await prompt.dismiss();
	await expect(page).toHaveURL(new RegExp(`/sites/${visit.siteId}`));
	await expect(input).toHaveText(String(CORRECTED));

	const unloading = page.waitForEvent('dialog');
	await page.close({ runBeforeUnload: true });
	const warning = await unloading;
	expect(warning.type()).toBe('beforeunload');
	await warning.dismiss();
});

// Scenario: a new visit is typed into the spare row under the table, its date and then its input.
// Expected behaviour: its calculated cell previews what the typed value makes it before Save opens
// the visit, as a listed visit's does.
test('a new row previews its calculated value before the visit is opened', async ({
	page,
	request,
}) => {
	const visit = await seedComputedVisit(request, 'b471', ENTERED);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${visit.siteId}?tab=visits`);
	await expect(page.getByText('1 visit', { exact: true })).toBeVisible();

	const day = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
	await typeInto(page, frozenCell(page, 1), day);
	const input = sheetCell(page, new RegExp(`^${visit.inputName} at`)).nth(1);
	const output = sheetCell(page, new RegExp(`^${visit.outputName} at`)).nth(1);
	await typeInto(page, input, String(CORRECTED));

	await expect(output).toHaveText(new RegExp(`^${CORRECTED * 2}\\b`));
	await expect(output).toHaveAttribute('title', /not saved yet/);
});
