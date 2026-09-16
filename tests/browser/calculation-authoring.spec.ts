import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { API_URL, BASE_PATH, signIn, token } from './portal';

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
// stores no Vaisala curve, so the identity curve is what the run is given.
//
// A separate output reads the site's altitude directly.

/** The golden visit's values, row 16 of the fixture's `field_data` case. */
const WTW_TEMP = 7.6;
const FIELD_BP = 836;
const FIELD_BP_ALTITUDE = 798;
const VAISALA_CO2_AVG = 320;
const ALTITUDE = 1234;
/** The one value the second story's visit holds. */
const ENTERED_INPUT = 12;

interface Fixture {
	stamp: string;
	siteName: string;
	groupLabel: string;
	codes: Record<string, string>;
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
		curveSlot: `vaisala_${stamp}`,
		temp: `WTW_Temp_degC_1_${stamp}`,
		fieldBp: `Field_BP_${stamp}`,
		altitudeBp: `Field_BP_altitude_${stamp}`,
		vaisala: `Vaisala_CO2_avg_${stamp}`,
		step: `bp_${stamp}`,
		output: `Vaisala_CO2_avg_corr_${stamp}`,
		altitude: `altitude_${stamp}`,
	};
	const values: Record<string, number> = {
		[codes.temp]: WTW_TEMP,
		[codes.fieldBp]: FIELD_BP,
		[codes.altitudeBp]: FIELD_BP_ALTITUDE,
		[codes.vaisala]: VAISALA_CO2_AVG,
	};

	const project = await post('/projects', { name: `Field data ${stamp}` });
	const siteName = `Field data ${stamp}`;
	const site = await post('/sites', { name: siteName, project_id: project.id, altitude_m: ALTITUDE });
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
	formula: { code: string; name: string; units: string; text: string; curveSlot?: string },
) {
	await page.getByRole('button', { name: 'Add formula', exact: true }).click();
	await page.getByRole('textbox', { name: 'Code' }).fill(formula.code);
	await page.getByRole('textbox', { name: 'Name', exact: true }).fill(formula.name);
	await page.getByRole('textbox', { name: 'Units' }).fill(formula.units);
	// The slot is declared before the formula is typed: the two coefficients it binds are unknown
	// identifiers until it is, and the lint holds Save while one stands.
	if (formula.curveSlot) {
		await page.getByRole('textbox', { name: 'Curve slot' }).fill(formula.curveSlot);
	}
	await page.getByPlaceholder('Type formula directly').fill(formula.text);
	await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeEnabled();
	await page.getByRole('button', { name: 'Done', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Add formula', exact: true })).toBeEnabled();
}

test('a CNET formula set is authored on the page and reproduces its golden visit', async ({
	page,
	request,
}) => {
	const { stamp, siteName, groupLabel, codes } = await seedCatalog(request);
	await signIn(page);

	// The calculation is made in the Toolbox from a name and a label. It names no parameter group
	// (Q169): the group holds the catalog's members, and the formulas name the parameters.
	await page.goto(`${BASE_PATH}/toolbox`);
	await page.getByRole('button', { name: 'New calculation' }).click();
	await page.getByRole('textbox', { name: 'Name' }).fill(`field_data_${stamp}`);
	await page.getByRole('textbox', { name: 'Label' }).fill(groupLabel);
	await page.getByRole('button', { name: 'Create and open it' }).click();
	await expect(page).toHaveURL(/\/toolbox\/[0-9a-f-]{36}/);
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
		text: `(${codes.vaisala} * curve_slope + curve_intercept) * ${codes.step} * 298 / (1013 * (273 + ${codes.temp}))`,
		curveSlot: codes.curveSlot,
	});

	// The set reads in dependency order, and the step is marked as one.
	const order = page
		.locator('section', { has: page.getByRole('heading', { name: 'Formulas' }) })
		.locator('ol > li');
	await expect(order.nth(0)).toContainText(codes.step);
	await expect(order.nth(0)).toContainText('shared');
	await expect(order.nth(1)).toContainText(codes.output);

	await addFormula(page, {
		code: codes.altitude,
		name: 'Site altitude',
		units: 'm',
		text: 'altitude_m',
	});

	// What the set reads, classified: an earlier formula's value, and the parameters read from the
	// visit. The declarations fold under the visit's numbers, so the fold is opened first. A row is
	// found by the code it opens with, so `bp_x` does not match `Field_BP_x`.
	const fold = (name: string) =>
		page.locator('details').filter({ has: page.locator('summary', { hasText: name }) });
	const inputs = fold('Inputs');
	await inputs.locator('summary').click();
	const reads = (code: string) =>
		inputs.getByRole('listitem').filter({ hasText: new RegExp(`^${code}`) });
	await expect(reads(codes.step)).toContainText('step');
	await expect(reads(codes.temp)).toContainText('parameter');
	await expect(reads(codes.fieldBp)).toContainText('parameter');
	await expect(reads('altitude_m')).toContainText('site');
	await expect(reads('curve_slope')).toContainText(`slot ${codes.curveSlot}`);

	// A shared step publishes nothing.
	const outputs = fold('Outputs');
	await outputs.locator('summary').click();
	const publishes = (code: string) =>
		outputs.getByRole('listitem').filter({ hasText: new RegExp(`^${code}`) });
	await expect(publishes(codes.output)).toHaveCount(1);
	await expect(publishes(codes.altitude)).toHaveCount(1);
	await expect(publishes(codes.step)).toHaveCount(0);

	// Run at the visit the catalog was seeded with. Nothing is written; the numbers come back.
	await page.getByRole('combobox', { name: 'Site' }).selectOption({ label: siteName });
	await page.getByLabel('Visit').selectOption({ index: 1 });

	// The slot needs coefficients or the correction is skipped for want of them. The golden case
	// stores no Vaisala curve, so the identity is what the portal read it against.
	const slot = `Curve slot ${codes.curveSlot}`;
	await expect(page.getByText(slot).first()).toBeVisible();
	await page.getByRole('button', { name: 'Manual', exact: true }).click();
	await page.getByRole('spinbutton', { name: `${slot} slope` }).fill('1');
	await page.getByRole('spinbutton', { name: `${slot} intercept` }).fill('0');

	await page.getByRole('button', { name: 'Run', exact: true }).click();

	// The step takes the field pressure, which is inside the guard's range, and the correction is
	// what the portal stored for the visit.
	const stepRow = page.locator(`#run-row-${codes.step}`);
	await expect(stepRow).toContainText(String(FIELD_BP));
	const outputRow = page.locator(`#run-row-${codes.output}`);
	await expect(outputRow).toContainText('280.463');
	await expect(page.locator(`#run-row-${codes.altitude}`)).toContainText(String(ALTITUDE));
});

/**
 * A calculation over one visit, authored through the routes rather than through the page: what the
 * second story is about is the page's own shape, so nothing here is typed.
 */
async function seedVisitCalculation(request: APIRequestContext) {
	const stamp = `${Date.now()}`;
	const bearer = await token(request);
	const headers = { Authorization: `Bearer ${bearer}` };
	const post = async (path: string, data: unknown) => {
		const response = await request.post(`${API_URL}/api${path}`, { headers, data });
		expect(response.ok(), `${path} -> ${response.status()} ${await response.text()}`).toBeTruthy();
		return response.json();
	};

	const inputCode = `m252_in_${stamp}`;
	const stepCode = `m252_step_${stamp}`;
	const outputCode = `m252_out_${stamp}`;
	const project = await post('/projects', { name: `Tool view ${stamp}` });
	const site = await post('/sites', {
		name: `Tool view ${stamp}`,
		project_id: project.id,
		altitude_m: ALTITUDE,
	});
	const input = await post('/parameters', {
		code: inputCode,
		name: inputCode,
		category: 'measurement',
		aliases: [],
	});
	await post('/site_parameters', { site_id: site.id, parameter_id: input.id, name: inputCode });

	const calculation = await post('/tool_scripts', {
		name: `m252_${stamp}`,
		label: `Tool view ${stamp}`,
		engine: 'formula',
	});
	// The step and the output in one save: a formula reading a step the set does not yet carry is
	// refused, and a save is the whole set (Q186).
	await post(`/tool_scripts/${calculation.id}/formulas`, {
		formulas: [
			{
				code: stepCode,
				name: 'Step',
				units: '',
				formula: `${inputCode} + 1`,
				ordinal: 1,
				intermediate: true,
			},
			{ code: outputCode, name: outputCode, units: 'ppm', formula: `${stepCode} * 2`, ordinal: 2 },
		],
	});

	const collectedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
	await post('/grab_samples', {
		site_id: site.id,
		mode: 'replace',
		readings: [
			{ parameter_id: input.id, value: ENTERED_INPUT, time: collectedAt, replicate_index: 0 },
		],
	});
	const visit = await post('/collection_events/stage', {
		site_id: site.id,
		collected_at: collectedAt,
	});
	return { calculationId: calculation.id, siteId: site.id, visitId: visit.id, inputCode, stepCode, outputCode };
}

// Scenario: a manager opens a calculation to see what it did at one visit (M252). The page is the
// visit's data, not the calculation's metadata.
//
// Expected behaviour: the site and the visit are in the URL, so the page opens on the four tables
// the portal draws, in its order, with the visit's numbers in them and nothing clicked.
test('a calculation opened at a visit shows the visit\'s numbers in the portal\'s tables', async ({
	page,
	request,
}) => {
	const { calculationId, siteId, visitId, inputCode, stepCode, outputCode } =
		await seedVisitCalculation(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/toolbox/${calculationId}?site=${siteId}&visit=${visitId}`);

	// What the visit held, before the calculation touched it.
	await expect(page.getByRole('columnheader', { name: 'Read at the visit' })).toBeVisible();
	await expect(page.getByRole('row').filter({ hasText: inputCode })).toContainText(
		String(ENTERED_INPUT),
	);
	// The step, then what the calculation publishes from it.
	await expect(page.locator(`#run-row-${stepCode}`)).toContainText(String(ENTERED_INPUT + 1));
	await expect(page.locator(`#run-row-${outputCode}`)).toContainText(
		String((ENTERED_INPUT + 1) * 2),
	);

	// The declarations are under the tables, folded, rather than above them.
	const declared = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Inputs' }) });
	await expect(declared).toHaveCount(1);
	await expect(declared.getByRole('listitem').first()).toBeHidden();
});
