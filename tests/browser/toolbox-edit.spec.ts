import { expect, test, type APIRequestContext } from '@playwright/test';
import { API_URL, BASE_PATH, signIn, token } from './portal';

// Scenario: a formula calculation and an R script are both listed in the Toolbox.
//
// Expected behaviour: Edit on the formula calculation opens its formulas and Edit on the R script
// opens its script, both under `/toolbox`, and the retired Manage Tools link lands on the script.

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

test('Edit opens a formula calculation on its formulas and an R script on its script', async ({
	page,
	request,
}) => {
	const { formula, script } = await seed(request);
	await signIn(page);

	const nav = page.getByRole('navigation');
	await page.goto(`${BASE_PATH}/toolbox`);
	await expect(nav.getByRole('link', { name: 'Toolbox' })).toBeVisible();
	await expect(nav.getByRole('link', { name: 'Manage Tools' })).toHaveCount(0);

	const listed = (label: string) => page.getByRole('listitem').filter({ hasText: label });
	await listed(formula.label).getByRole('link', { name: 'Edit' }).click();
	await expect(page).toHaveURL(new RegExp(`/toolbox/${formula.id}$`));
	await expect(page.getByRole('heading', { name: 'Formulas', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Save as new version' })).toHaveCount(0);

	await page.goto(`${BASE_PATH}/toolbox`);
	await listed(script.label).getByRole('link', { name: 'Edit' }).click();
	await expect(page).toHaveURL(new RegExp(`/toolbox/${script.id}$`));
	await expect(page.getByRole('button', { name: 'Save as new version' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Formulas', exact: true })).toHaveCount(0);

	await page.goto(`${BASE_PATH}/tools/manage?script=${script.name}`);
	await expect(page).toHaveURL(new RegExp(`/toolbox/${script.name}$`));
	await expect(page.getByRole('heading', { name: script.name })).toBeVisible();
});
