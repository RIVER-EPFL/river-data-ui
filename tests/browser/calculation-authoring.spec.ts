import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { BASE_PATH, signIn } from './portal';

// Scenario: the lab authors a CNET calculator by hand, which Q149 made the only path a deployment
// has to one, and the calculation page is the surface it is typed on. `tests/tools/cnet_authoring.rs`
// proves the six sets through the routes; this drives the page that posts to them.
//
// Expected behaviour: a calculation is made from the Toolbox, its formulas are typed and saved on
// its own page, the page classifies what they read and orders them by their dependencies, and a run
// at a visit reproduces the number the portal stored.
//
// The set is `field_data`'s CO2 correction at its golden visit (VAD 2019-06-25, row 16 of
// `river-data-api/tests/fixtures/cnet_formula_sets.json`): the pressure guard `bp`, which belongs
// to no calculation and is brought in as a dependency, and the correction that reads it. The case
// stores no Vaisala curve, so the identity curve stands in and the correction is the arithmetic
// without it.
//
// Two constructs of the set are left out because the page cannot carry them today: the site
// property `altitude_m` that `Field_BP_altitude` reads (B268) and the curve slot the corrections
// declare (B270). The stored `Field_BP_altitude` reading stands in for the first.

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3005';
const KEYCLOAK_URL = process.env.E2E_KEYCLOAK_URL ?? 'http://localhost:8180/';

/** The golden visit's values, row 16 of the fixture's `field_data` case. */
const WTW_TEMP = 7.6;
const FIELD_BP = 836;
const FIELD_BP_ALTITUDE = 798;
const VAISALA_CO2_AVG = 320;

interface Fixture {
	stamp: string;
	siteName: string;
	groupLabel: string;
	codes: Record<string, string>;
}

async function token(request: APIRequestContext): Promise<string> {
	const response = await request.post(
		`${KEYCLOAK_URL.replace(/\/$/, '')}/realms/river-data/protocol/openid-connect/token`,
		{
			form: {
				client_id: 'river-data-ui-local',
				username: 'admin',
				password: 'admin',
				grant_type: 'password',
			},
		},
	);
	expect(response.ok(), 'the seeded realm issues a token for admin').toBeTruthy();
	return (await response.json()).access_token;
}

/**
 * The catalog the set reads and the visit it runs at. Codes carry the run's stamp because a
 * parameter code is unique across the database and belongs to one group, so a second run of the
 * story would be refused its members.
 */
async function seedCatalog(request: APIRequestContext): Promise<Fixture> {
	const stamp = `${Date.now()}`;
	const bearer = await token(request);
	const headers = { Authorization: `Bearer ${bearer}` };
	const post = async (path: string, data: unknown) => {
		const response = await request.post(`${API_URL}/api${path}`, { headers, data });
		expect(response.ok(), `${path} -> ${response.status()} ${await response.text()}`).toBeTruthy();
		return response.json();
	};

	const codes = {
		temp: `WTW_Temp_degC_1_${stamp}`,
		fieldBp: `Field_BP_${stamp}`,
		altitudeBp: `Field_BP_altitude_${stamp}`,
		vaisala: `Vaisala_CO2_avg_${stamp}`,
		step: `bp_${stamp}`,
		output: `Vaisala_CO2_avg_corr_${stamp}`,
	};
	const values: Record<string, number> = {
		[codes.temp]: WTW_TEMP,
		[codes.fieldBp]: FIELD_BP,
		[codes.altitudeBp]: FIELD_BP_ALTITUDE,
		[codes.vaisala]: VAISALA_CO2_AVG,
	};

	const project = await post('/projects', { name: `Field data ${stamp}` });
	const siteName = `Field data ${stamp}`;
	const site = await post('/sites', { name: siteName, project_id: project.id });
	const groupLabel = `Field data ${stamp}`;
	const group = await post('/parameter_groups', {
		code: `field_data_${stamp}`,
		label: groupLabel,
		ordinal: 1,
	});

	const collectedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
	const readings = [];
	for (const [ordinal, code] of Object.keys(values).entries()) {
		const parameter = await post('/parameters', {
			code,
			name: code,
			category: 'measurement',
			aliases: [],
		});
		await post('/parameter_group_members', {
			group_id: group.id,
			parameter_id: parameter.id,
			role: 'measured',
			ordinal,
		});
		await post('/site_parameters', { site_id: site.id, parameter_id: parameter.id, name: code });
		readings.push({
			parameter_id: parameter.id,
			value: values[code],
			time: collectedAt,
			replicate_index: 0,
		});
	}
	await post('/grab_samples', { site_id: site.id, mode: 'replace', readings });

	// The pressure guard belongs to no calculation: `field_data` and `pco2` both read it, so it is
	// authored once and declared as a dependency by each (Q156).
	await post('/derived_parameters', {
		code: codes.step,
		name: 'Pressure used',
		units: 'hPa',
		formula: `if(and(ge(${codes.fieldBp}, 700), le(${codes.fieldBp}, 1050)), ${codes.fieldBp}, ${codes.altitudeBp})`,
		ordinal: 1,
		intermediate: true,
	});
	await post('/collection_events/stage', { site_id: site.id, collected_at: collectedAt });
	return { stamp, siteName, groupLabel, codes };
}

/** One formula typed into the editor as the lab types it, then saved. */
async function addFormula(
	page: Page,
	formula: { code: string; name: string; units: string; text: string },
) {
	await page.getByRole('button', { name: 'Add formula', exact: true }).click();
	await page.getByRole('textbox', { name: 'Code' }).fill(formula.code);
	await page.getByRole('textbox', { name: 'Name', exact: true }).fill(formula.name);
	await page.getByRole('textbox', { name: 'Units' }).fill(formula.units);
	await page.getByPlaceholder('Type formula directly').fill(formula.text);
	await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeEnabled();
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Add formula', exact: true })).toBeEnabled();
}

test('a CNET formula set is authored on the page and reproduces its golden visit', async ({
	page,
	request,
}) => {
	const { stamp, siteName, groupLabel, codes } = await seedCatalog(request);
	await signIn(page);

	// The calculation is made in the Toolbox, which is where the engine and the group are chosen.
	await page.goto(`${BASE_PATH}/toolbox`);
	await page.getByRole('button', { name: 'New calculation' }).click();
	await page.getByRole('textbox', { name: 'Name' }).fill(`field_data_${stamp}`);
	await page.getByRole('textbox', { name: 'Label' }).fill(groupLabel);
	await page.getByLabel('Parameter group').selectOption({ label: groupLabel });
	await page.getByRole('button', { name: 'Create and open it' }).click();
	await expect(page).toHaveURL(/\/calculations\/[0-9a-f-]{36}/);
	await expect(page.getByRole('heading', { name: groupLabel })).toBeVisible();

	// The step is not retyped: the calculation declares that it reads the one already written.
	await page
		.getByLabel('A step written elsewhere')
		.selectOption({ label: `${codes.step} · Pressure used` });
	await page.getByRole('button', { name: 'Bring in' }).click();
	await expect(page.getByRole('button', { name: 'What it feeds' })).toBeVisible();

	await addFormula(page, {
		code: codes.output,
		name: 'Vaisala CO2 avg corrected',
		units: 'ppm',
		text: `${codes.vaisala} * ${codes.step} * 298 / (1013 * (273 + ${codes.temp}))`,
	});

	// The set reads in dependency order, and the step is marked as one.
	const order = page
		.locator('section', { has: page.getByRole('heading', { name: 'Formulas' }) })
		.locator('ol > li');
	await expect(order.nth(0)).toContainText(codes.step);
	await expect(order.nth(0)).toContainText('shared');
	await expect(order.nth(1)).toContainText(codes.output);

	// What the set reads, classified: an earlier formula's value, and the parameters read from the
	// visit. A row is found by the code it opens with, so `bp_x` does not match `Field_BP_x`.
	const inputs = page.locator('section', { has: page.getByRole('heading', { name: 'Inputs' }) });
	const reads = (code: string) =>
		inputs.getByRole('listitem').filter({ hasText: new RegExp(`^${code}`) });
	await expect(reads(codes.step)).toContainText('step');
	await expect(reads(codes.temp)).toContainText('parameter');
	await expect(reads(codes.fieldBp)).toContainText('parameter');

	// A step publishes nothing, so only the correction is an output.
	const outputs = page.locator('section', { has: page.getByRole('heading', { name: 'Outputs' }) });
	const publishes = (code: string) =>
		outputs.getByRole('listitem').filter({ hasText: new RegExp(`^${code}`) });
	await expect(publishes(codes.output)).toHaveCount(1);
	await expect(publishes(codes.step)).toHaveCount(0);

	// Run at the visit the catalog was seeded with. Nothing is written; the numbers come back.
	await page.getByRole('combobox', { name: 'Site' }).selectOption({ label: siteName });
	await page.getByLabel('Visit').selectOption({ index: 1 });
	await page.getByRole('button', { name: 'Run', exact: true }).click();

	// The step takes the field pressure, which is inside the guard's range, and the correction is
	// what the portal stored for the visit.
	const stepRow = page.locator(`#run-row-${codes.step}`);
	await expect(stepRow).toContainText(String(FIELD_BP));
	const outputRow = page.locator(`#run-row-${codes.output}`);
	await expect(outputRow).toContainText('280.463');
});
