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
	groupLabel: string;
	calculation: string;
	calculationId: string;
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
		groupLabel,
		calculation,
		calculationId: script.id,
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
