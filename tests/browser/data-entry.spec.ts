import { expect, test, type APIRequestContext } from '@playwright/test';
import { API_URL, BASE_PATH, saveFormulaSet, signIn, token } from './portal';

// Scenario: an operator entering a field day opens Data entry from the sidebar. Expected
// behaviour: picking the station lists its visits in place, a visit added at a typed time is the
// one chosen, a form computes its output there, and the save writes into that visit.

async function seedFormula(request: APIRequestContext) {
	const stamp = `${Date.now()}`;
	const headers = { Authorization: `Bearer ${await token(request)}` };
	const post = async (path: string, data: unknown) => {
		const response = await request.post(`${API_URL}/api${path}`, { headers, data });
		expect(response.ok(), `${path} -> ${response.status()} ${await response.text()}`).toBeTruthy();
		return response.json();
	};
	const inputName = `entry_in_${stamp}`;
	const outputName = `entry_out_${stamp}`;
	const calculation = `entry_${stamp}`;
	const siteName = `Entry station ${stamp}`;
	const project = await post('/projects', { name: siteName });
	const site = await post('/sites', { name: siteName, project_id: project.id });
	const group = await post('/parameter_groups', { code: calculation, label: siteName, ordinal: 1 });
	const declare = async (parameterId: string, code: string, role: string, ordinal: number) => {
		await post('/parameter_group_members', { group_id: group.id, parameter_id: parameterId, role, ordinal });
		// The visit arm: a slot left at the column default is the stream engine's, and the chain
		// skips an output it holds.
		await post('/site_parameters', {
			site_id: site.id,
			parameter_id: parameterId,
			name: code,
			cadence: 'low',
		});
	};
	const input = await post('/parameters', {
		code: inputName,
		name: inputName,
		category: 'measurement',
		aliases: [],
	});
	await declare(input.id, inputName, 'measured', 0);
	const script = await post('/tool_scripts', {
		name: calculation,
		label: calculation,
		engine: 'formula',
		parameter_group_id: group.id,
	});
	const derived = await saveFormulaSet(request, headers, script.id, {
		code: outputName,
		name: outputName,
		units: '',
		formula: `${inputName} * 2`,
		ordinal: 1,
	});
	await declare(derived.output_parameter_id, outputName, 'output', 1);
	await post('/collection_events/stage', { site_id: site.id, collected_at: '2025-06-10T09:00:00Z' });
	return { siteId: site.id, siteName, calculation, inputName, outputName };
}

test('a field day is entered from Data entry: station, date, a form, save', async ({ page, request }) => {
	const { siteId, siteName, calculation, inputName, outputName } = await seedFormula(request);
	await signIn(page);

	await page.getByRole('navigation').getByRole('link', { name: 'Data entry', exact: true }).first().click();
	await expect(page.getByRole('heading', { name: 'Data entry', exact: true })).toBeVisible();
	await page.getByLabel('Station').selectOption({ label: siteName });
	await expect(
		page.getByRole('list', { name: 'Visits at this station' }).getByRole('button'),
	).toHaveCount(1);
	await page.getByLabel('New visit at').fill('2025-06-15T09:00');
	await page.getByRole('button', { name: 'Add visit' }).click();
	await expect(page.getByText('Field visit').first()).toBeVisible();
	await expect(page.getByText(siteName).first()).toBeVisible();

	await page.getByRole('button', { name: new RegExp(`^${calculation}`) }).click();
	// The output computes as the value is typed, with nothing to press.
	await page.getByRole('spinbutton', { name: inputName }).fill('7');
	await expect(page.getByText(outputName).first()).toBeVisible();
	await expect(page.locator(`#run-row-${outputName}`)).toContainText('14');

	await page.getByRole('button', { name: 'Check against site history' }).click();
	await expect(page.getByRole('button', { name: 'Re-check' })).toBeVisible();
	await page.getByRole('button', { name: 'Save to Site', exact: true }).click();
	const save = page.getByRole('dialog');
	await save.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(save).toBeHidden();

	// A value typed after the save is not left behind silently, and Reset takes it back.
	const input = page.getByRole('spinbutton', { name: inputName });
	await input.fill('9');
	await expect(page.locator(`#run-row-${outputName}`)).toContainText('18');
	const prompt = page.waitForEvent('dialog');
	void page.getByRole('navigation').getByRole('link', { name: 'Parameters', exact: true }).first().click();
	const asked = await prompt;
	expect(asked.message()).toContain('not saved yet');
	await asked.dismiss();
	await page.getByRole('button', { name: 'Reset', exact: true }).click();
	await expect(input).toHaveValue('7');

	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('2 visits', { exact: true })).toBeVisible();
});

test('a link to the retired tools page lands on Data entry with its query', async ({ page }) => {
	await signIn(page);
	await page.goto(`${BASE_PATH}/tools?tool=doc`);
	await expect(page).toHaveURL(new RegExp(`${BASE_PATH}/data-entry\\?tool=doc`));
	await expect(page.getByRole('heading', { name: 'Data entry', exact: true })).toBeVisible();
});
