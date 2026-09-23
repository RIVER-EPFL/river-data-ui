import { expect, test, type APIRequestContext } from '@playwright/test';
import { API_URL, BASE_PATH, signIn, token } from './portal';

// Scenario: a formula calculation and an R script with no version yet are both listed in the
// Toolbox, one row each.
//
// Expected behaviour: the formula calculation's name opens its formulas and the R script's opens
// its script, both under `/toolbox`, and the retired Manage Tools link lands on the script.

async function seed(request: APIRequestContext) {
	const stamp = `${Date.now()}`;
	const headers = { Authorization: `Bearer ${await token(request)}` };
	const post = async (data: unknown) => {
		const response = await request.post(`${API_URL}/api/tool_scripts`, { headers, data });
		expect(response.ok(), `/tool_scripts -> ${response.status()} ${await response.text()}`).toBeTruthy();
		return response.json();
	};
	const formula = await post({ name: `pco2_demo_${stamp}`, label: `pCO2 ${stamp}`, engine: 'formula' });
	const script = await post({ name: `doc_${stamp}`, label: `DOC ${stamp}`, engine: 'script' });
	return { formula, script };
}

test('a calculation name opens a formula calculation on its formulas and an R script on its script', async ({
	page,
	request,
}) => {
	const { formula, script } = await seed(request);
	await signIn(page);

	const nav = page.getByRole('navigation');
	await page.goto(`${BASE_PATH}/toolbox`);
	await expect(nav.getByRole('link', { name: 'Toolbox' })).toBeVisible();
	await expect(nav.getByRole('link', { name: 'Manage Tools' })).toHaveCount(0);

	const listed = (label: string) => page.getByRole('link', { name: label, exact: true });
	await expect(page.getByRole('row').filter({ hasText: script.name })).toContainText('no version active');
	await listed(formula.label).click();
	await expect(page).toHaveURL(new RegExp(`/toolbox/${formula.id}$`));
	await expect(page.getByRole('heading', { name: 'At this visit', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Save as new version' })).toHaveCount(0);

	await page.goto(`${BASE_PATH}/toolbox`);
	await listed(script.label).click();
	await expect(page).toHaveURL(new RegExp(`/toolbox/${script.id}$`));
	await expect(page.getByRole('button', { name: 'Save as new version' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'At this visit', exact: true })).toHaveCount(0);

	await page.goto(`${BASE_PATH}/tools/manage?script=${script.name}`);
	await expect(page).toHaveURL(new RegExp(`/toolbox/${script.name}$`));
	await expect(page.getByRole('heading', { name: script.name })).toBeVisible();
});

// Scenario: the Toolbox opened at desktop and at phone width.
//
// Expected behaviour: New calculation is the first primary control in the page, visible without
// scrolling, left-aligned under the title; the engine explanation appears only once the composer
// is open.
for (const viewport of [
	{ width: 1400, height: 900 },
	{ width: 390, height: 844 },
]) {
	test(`New calculation leads the Toolbox at ${viewport.width} px`, async ({ page }) => {
		await page.setViewportSize(viewport);
		await signIn(page);
		await page.goto(`${BASE_PATH}/toolbox`);

		const main = page.getByRole('main');
		const create = main.getByRole('button', { name: 'New calculation' });
		await expect(create).toBeInViewport();
		const firstPrimary = main.locator('button.bg-brand-primary').first();
		await expect(firstPrimary).toHaveText('New calculation');

		const title = await main.getByRole('heading', { name: 'Toolbox', level: 1 }).boundingBox();
		const button = await create.boundingBox();
		expect(button!.x).toBeLessThanOrEqual(title!.x + 1);
		expect(button!.y).toBeGreaterThan(title!.y);

		await expect(main.getByText('An R tool is a calculation with the R script engine')).toHaveCount(0);
		await create.click();
		await expect(main.getByText('An R tool is a calculation with the R script engine')).toBeVisible();
		await expect(main.getByRole('button', { name: 'Create and open it' })).toBeVisible();
	});
}
