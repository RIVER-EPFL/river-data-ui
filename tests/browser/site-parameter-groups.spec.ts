import { expect, test, type APIRequestContext } from '@playwright/test';
import { API_URL, BASE_PATH, saveFormulaSet, signIn, token } from './portal';

// Scenario: applying a parameter group at a site. The group brings in the columns entered at a
// visit and the ones its calculations publish, and U61 requires the tab to say so afterwards.
//
// Expected behaviour: the slots stand under the group that brought them in, the calculation is
// named on the group header as declared here, and each slot it reads or publishes carries a chip
// linking to the calculation.

interface Fixture {
	siteId: string;
	groupId: string;
	groupLabel: string;
	calculation: string;
	calculationId: string;
	inputId: string;
	inputName: string;
	outputName: string;
}

/** A site holding no slots, and a group of one entered column and one a calculation publishes. */
async function seedGroup(request: APIRequestContext): Promise<Fixture> {
	const stamp = `${Date.now()}`;
	const bearer = await token(request);
	const headers = { Authorization: `Bearer ${bearer}` };
	const post = async (path: string, data: unknown) => {
		const response = await request.post(`${API_URL}/api${path}`, { headers, data });
		expect(response.ok(), `${path} -> ${response.status()} ${await response.text()}`).toBeTruthy();
		return response.json();
	};

	const inputName = `u61_in_${stamp}`;
	const outputName = `u61_out_${stamp}`;
	const calculation = `u61_${stamp}`;
	const groupLabel = `Headspace ${stamp}`;
	const project = await post('/projects', { name: groupLabel });
	const site = await post('/sites', { name: groupLabel, project_id: project.id });
	const group = await post('/parameter_groups', { code: calculation, label: groupLabel, ordinal: 1 });

	const input = await post('/parameters', {
		code: inputName,
		name: inputName,
		category: 'measurement',
		aliases: [],
	});
	await post('/parameter_group_members', {
		group_id: group.id,
		parameter_id: input.id,
		role: 'measured',
		ordinal: 0,
	});

	// The calculation mints its own output parameter (Q183), so only the input is declared here.
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
	await post('/parameter_group_members', {
		group_id: group.id,
		parameter_id: derived.output_parameter_id,
		role: 'output',
		ordinal: 1,
	});

	return {
		siteId: site.id,
		groupId: group.id,
		groupLabel,
		calculation,
		calculationId: script.id,
		inputId: input.id,
		inputName,
		outputName,
	};
}

test('applying a group shows its columns together and names the calculation declared here', async ({
	page,
	request,
}) => {
	const fixture = await seedGroup(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${fixture.siteId}?tab=parameters`);

	await page.getByRole('button', { name: 'Apply group', exact: true }).click();
	await page.getByLabel('Parameter group').selectOption({ label: `${fixture.groupLabel} (${fixture.calculation})` });

	// Which parameters arrive is read before the write, not from the toast after it.
	await expect(page.getByText('Will add (2)')).toBeVisible();
	await expect(page.getByText(`${fixture.inputName} (${fixture.inputName}) · Measured`)).toBeVisible();
	await expect(page.getByText(`${fixture.outputName} (${fixture.outputName}) · Output`)).toBeVisible();
	await expect(page.getByText('Already here (0)')).toBeVisible();

	await page.getByRole('button', { name: 'Apply', exact: true }).click();

	// The header is the group, carrying what it brought in and the calculation it declared here.
	const header = page.getByRole('button', { name: new RegExp(`^${fixture.groupLabel}`) });
	await expect(header).toBeVisible();
	const headerRow = page.getByRole('row', { name: new RegExp(fixture.groupLabel) });
	await expect(headerRow).toContainText('2 parameters');
	await expect(headerRow).toContainText('Declared here:');
	await expect(headerRow.getByRole('link', { name: fixture.calculation })).toHaveAttribute(
		'href',
		`${BASE_PATH}/toolbox/${fixture.calculationId}`,
	);

	// Both what the calculation reads and what it publishes are chipped with it.
	for (const name of [fixture.inputName, fixture.outputName]) {
		const row = page.getByRole('row', { name: new RegExp(`^${name}`) });
		await expect(row.getByRole('link', { name: fixture.calculation })).toBeVisible();
	}

	// Collapsing the group takes its slots with it.
	await header.click();
	await expect(page.getByRole('row', { name: new RegExp(`^${fixture.inputName}`) })).toBeHidden();
});

// Scenario: a calculation is applied at a site from the site's Parameters tab, the one place it is
// applied, and the calculation's own page and the Toolbox only say where it is.
//
// Expected behaviour: the dry run names the output to add, Apply adds it, the calculation page
// links the site read-only with no apply control of its own, and the Toolbox counts the site and
// links it back to the Parameters tab opened on this calculation.
test('a calculation applied from the Parameters tab is listed on its page as applied there', async ({
	page,
	request,
}) => {
	const fixture = await seedGroup(request);
	const headers = { Authorization: `Bearer ${await token(request)}` };
	const declared = await request.post(`${API_URL}/api/site_parameters`, {
		headers,
		data: { site_id: fixture.siteId, parameter_id: fixture.inputId, name: fixture.inputName, cadence: 'low' },
	});
	expect(declared.ok(), await declared.text()).toBeTruthy();

	await signIn(page);
	await page.goto(`${BASE_PATH}/toolbox/${fixture.calculationId}`);
	const line = page.getByTestId('calculation-sites');
	await expect(line).toContainText('Applied at no site yet');
	await expect(page.getByText('Apply at a site')).toHaveCount(0);

	await page.goto(`${BASE_PATH}/sites/${fixture.siteId}?tab=parameters`);
	await page.getByRole('button', { name: 'Apply calculation', exact: true }).click();
	await page.getByLabel('Calculation').selectOption({ label: fixture.calculation });
	await expect(page.getByText('Outputs to add (1)')).toBeVisible();
	await page.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(page.getByText('Already applied here.')).toBeVisible();

	await page.goto(`${BASE_PATH}/toolbox/${fixture.calculationId}`);
	await expect(line.getByRole('link', { name: fixture.groupLabel })).toHaveAttribute(
		'href',
		`${BASE_PATH}/sites/${fixture.siteId}?tab=parameters`,
	);

	await page.goto(`${BASE_PATH}/toolbox`);
	await page.getByRole('searchbox', { name: 'Search calculations' }).fill(fixture.calculation);
	await page.getByRole('button', { name: /^1 site/ }).click();
	await page.getByRole('cell', { name: /^Fires at/ }).getByRole('link', { name: fixture.groupLabel }).click();
	await expect(page).toHaveURL(new RegExp(`/sites/${fixture.siteId}\\?tab=parameters&calculation=`));
	await expect(page.getByLabel('Calculation')).toHaveValue(fixture.calculationId);
	await expect(page.getByText('Already applied here.')).toBeVisible();
});

// Scenario: a site's Parameters tab read at a laptop width, with a slot to find among several.
//
// Expected behaviour: each slot is one line whose actions stay in view without the page scrolling
// sideways; the search leaves the slots whose code or name matches, Calculated leaves only what a
// calculation publishes, and opening a row reaches the controls its configuration line summarises.
test('the Parameters tab fits a laptop window and finds a slot by name or by being calculated', async ({
	page,
	request,
}) => {
	const fixture = await seedGroup(request);
	const headers = { Authorization: `Bearer ${await token(request)}` };
	const post = async (path: string, data: unknown) => {
		const response = await request.post(`${API_URL}/api${path}`, { headers, data });
		expect(response.ok(), `${path} -> ${response.status()} ${await response.text()}`).toBeTruthy();
		return response.json();
	};
	await post(`/sites/${fixture.siteId}/parameter_groups`, { group_id: fixture.groupId });
	const oxygen = await post('/parameters', {
		code: `DO_${fixture.calculation}`,
		name: 'Dissolved oxygen',
		category: 'measurement',
		aliases: [],
	});
	await post('/site_parameters', {
		site_id: fixture.siteId,
		parameter_id: oxygen.id,
		name: 'Dissolved oxygen',
		cadence: 'low',
	});

	await page.setViewportSize({ width: 1230, height: 800 });
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${fixture.siteId}?tab=parameters`);
	const rowOf = (code: string) => page.getByRole('row', { name: new RegExp(`^${code}`) });
	await expect(rowOf(fixture.inputName)).toBeVisible();

	expect(
		await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
		'the page does not scroll sideways',
	).toBeLessThanOrEqual(1);
	const actions = page.getByRole('button', { name: `Actions for ${fixture.inputName}` });
	await expect(actions).toBeInViewport();
	await actions.click();
	await expect(page.getByRole('menu').getByRole('button', { name: 'Merge…' })).toBeVisible();
	await page.keyboard.press('Escape');

	const search = page.getByRole('searchbox', { name: 'Search parameters by code or name' });
	await search.fill('dissolved');
	await expect(rowOf(oxygen.code)).toBeVisible();
	await expect(rowOf(fixture.inputName)).toBeHidden();
	await search.fill('');

	await page.getByRole('button', { name: 'Calculated', exact: true }).click();
	await expect(rowOf(fixture.outputName)).toBeVisible();
	await expect(rowOf(fixture.inputName)).toBeHidden();
	await expect(rowOf(oxygen.code)).toBeHidden();
	await page.getByRole('button', { name: 'Calculated', exact: true }).click();

	await rowOf(oxygen.code).getByRole('button', { name: oxygen.code }).click();
	await expect(page.getByLabel('Sample interval in seconds for Dissolved oxygen')).toBeVisible();
	await expect(page.getByLabel('Instrument for Dissolved oxygen')).toBeVisible();
});
