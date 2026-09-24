import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { API_URL, BASE_PATH, signIn, token } from './portal';
import { calculationCell, typeInto } from './sheet';

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
	siteId: string;
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
		spare: `Spare_${stamp}`,
		step: `bp_${stamp}`,
		output: `Vaisala_CO2_avg_corr_${stamp}`,
		altitude: `altitude_${stamp}`,
	};
	const values: Record<string, number> = {
		[codes.temp]: WTW_TEMP,
		[codes.fieldBp]: FIELD_BP,
		[codes.altitudeBp]: FIELD_BP_ALTITUDE,
		[codes.vaisala]: VAISALA_CO2_AVG,
		[codes.spare]: 1,
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
	return { stamp, siteId: site.id, siteName, groupLabel, codes };
}

/** One formula typed into the editor as the lab types it, then saved. */
async function addFormula(
	page: Page,
	formula: { code: string; name: string; units: string; text: string; curveSlot?: string },
) {
	await page.getByRole('button', { name: 'Add output', exact: true }).click();
	// Key by key: each keystroke renames the row, which is what a single fill() never shows.
	const code = page.getByRole('textbox', { name: 'Code' });
	await code.click();
	await code.pressSequentially(formula.code);
	await expect(code).toBeFocused();
	await expect(code).toHaveValue(formula.code);
	await page.getByRole('textbox', { name: 'Name', exact: true }).fill(formula.name);
	await page.getByRole('textbox', { name: 'Units' }).fill(formula.units);
	// The slot is declared before the formula is typed: the two coefficients it binds are unknown
	// identifiers until it is, and the lint holds Save while one stands.
	if (formula.curveSlot) {
		await page.getByRole('textbox', { name: 'Curve slot' }).fill(formula.curveSlot);
	}
	await page.getByPlaceholder('Type formula directly').fill(formula.text);
	// The panel writes into the set as it is typed; the row is in the tables once it has a code.
	await expect(page.locator(`td[data-sheet-row="${formula.code}"]`).first()).toBeVisible();
}

/** One of the three tables, by the heading its first column carries. */
const block = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

/** A row of one table, found by its label cell: every row has one, computed or not. */
const rowOf = (table: Locator, code: string) =>
	table.locator(`td[data-sheet-row="${code}"][data-sheet-column="0"]`);

test('a CNET formula set is authored on the page and reproduces its golden visit', async ({
	page,
	request,
}) => {
	const { stamp, siteId, groupLabel, codes } = await seedCatalog(request);
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

	// A calculation with no formulas has no rows to drop onto, and the first input goes in before
	// anything names it: the inputs block itself takes the drop, outlined until a formula reads it.
	const palette = page.getByRole('region', { name: 'Palette' });
	const inputs = block(page, 'Inputs');
	await expect(inputs).toContainText('Drop a parameter or constant here');
	await palette.getByRole('button', { name: codes.fieldBp, exact: true }).dragTo(inputs);
	await expect(rowOf(inputs, codes.fieldBp)).toHaveClass(/sheet-unused/);

	// The step is not retyped: the calculation declares that it reads the one already written.
	await page
		.getByLabel('A step written elsewhere')
		.selectOption({ label: `${codes.step} · Pressure used` });
	await page.getByRole('button', { name: 'Bring in' }).click();
	await expect(rowOf(block(page, 'Steps'), codes.step)).toBeVisible();

	await addFormula(page, {
		code: codes.output,
		name: 'Vaisala CO2 avg corrected',
		units: 'ppm',
		text: `(${codes.vaisala} * curve_slope + curve_intercept) * ${codes.step} * 298 / (1013 * (273 + ${codes.temp}))`,
		curveSlot: codes.curveSlot,
	});

	// A step is held apart from what the calculation publishes.
	await expect(rowOf(block(page, 'Steps'), codes.step)).toBeVisible();
	await expect(rowOf(block(page, 'Outputs'), codes.output)).toBeVisible();

	await addFormula(page, {
		code: codes.altitude,
		name: 'Site altitude',
		units: 'm',
		text: 'altitude_m',
	});

	// What the set reads is the inputs table: the parameters read from the visit, the site's own
	// column, and the coefficients the declared slot binds. A step is not an input; it is computed.
	for (const name of [codes.temp, codes.fieldBp, 'altitude_m', 'curve_slope']) {
		await expect(rowOf(inputs, name)).toBeVisible();
	}
	await expect(rowOf(inputs, codes.step)).toHaveCount(0);

	// A shared step publishes nothing.
	const outputs = block(page, 'Outputs');
	await expect(rowOf(outputs, codes.output)).toHaveCount(1);
	await expect(rowOf(outputs, codes.altitude)).toHaveCount(1);
	await expect(rowOf(outputs, codes.step)).toHaveCount(0);

	// A parameter no formula names yet is brought in from the palette: it is a row of the inputs
	// table, outlined, and the save does not keep it.
	await palette
		.getByRole('button', { name: codes.spare, exact: true })
		.dragTo(rowOf(inputs, codes.temp));
	await expect(rowOf(inputs, codes.spare)).toHaveClass(/sheet-unused/);
	await expect(page.getByText('the save does not keep it')).toBeVisible();

	// The slot needs coefficients or the correction is skipped for want of them. The golden case
	// stores no Vaisala curve, so the identity is what the portal read it against.
	const slot = `Curve slot ${codes.curveSlot}`;
	await expect(page.getByText(slot).first()).toBeVisible();
	await page.getByRole('button', { name: 'Manual', exact: true }).click();
	await page.getByRole('spinbutton', { name: `${slot} slope` }).fill('1');
	await page.getByRole('spinbutton', { name: `${slot} intercept` }).fill('0');

	// The golden values typed into the input cells, with no visit chosen: the set computes on the
	// numbers in front of the author, before it is saved and before it has been near a visit.
	const cell = (code: string) => calculationCell(page, code);
	for (const [code, value] of [
		[codes.vaisala, VAISALA_CO2_AVG],
		[codes.temp, WTW_TEMP],
		[codes.fieldBp, FIELD_BP],
		[codes.altitudeBp, FIELD_BP_ALTITUDE],
		['altitude_m', ALTITUDE],
	] as const) {
		await typeInto(page, cell(code), String(value));
	}
	await expect(cell(codes.output)).toContainText('280.463');

	// The same numbers read from the visit the catalog was seeded with. One site and visit choice
	// serves the whole page, and choosing it fills the tables: there is nothing to press.
	// The picker says how much of what the set reads each site measures, so a site that cannot draw
	// it is readable before it is chosen.
	const sitePicker = page.getByRole('combobox', { name: 'Site' });
	await expect(sitePicker.locator(`option[value="${siteId}"]`)).toHaveText(
		/ · measures (all )?\d+/,
	);
	await sitePicker.selectOption(siteId);
	await expect(page.getByRole('combobox', { name: 'Visit' })).not.toHaveValue('');

	// The step takes the field pressure, which is inside the guard's range, and the correction is
	// what the portal stored for the visit.
	await expect(cell(codes.step)).toContainText(String(FIELD_BP));
	await expect(cell(codes.output)).toContainText('280.463');
	await expect(cell(codes.altitude)).toContainText(String(ALTITUDE));

	// Selecting a cell says what made it: the correction lights the step it reads, and the step
	// lights the field pressure it is a guard over.
	await cell(codes.output).click();
	await expect(rowOf(block(page, 'Steps'), codes.step)).toHaveClass(/sheet-reads/);
	await cell(codes.step).click();
	await expect(rowOf(inputs, codes.fieldBp)).toHaveClass(/sheet-reads/);
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

// Scenario: a manager opens a calculation to see what it did at one visit (M252), then an author
// opens an output to set its units (M333). The page is the visit's data, not the calculation's
// metadata, and it is one screen.
//
// Expected behaviour: the site and the visit are in the URL, so the page opens on the inputs,
// steps and outputs blocks, with the visit's numbers in them and nothing clicked. Opening a cell
// puts its units, its bounds and its Drop on screen without the sheet leaving it.
test('a calculation opened at a visit shows the visit\'s numbers in the portal\'s tables', async ({
	page,
	request,
}) => {
	const { calculationId, siteId, visitId, inputCode, stepCode, outputCode } =
		await seedVisitCalculation(request);
	await page.setViewportSize({ width: 1600, height: 1080 });
	await signIn(page);
	await page.goto(`${BASE_PATH}/toolbox/${calculationId}?site=${siteId}&visit=${visitId}`);

	// What the visit held, before the calculation touched it, in the inputs block.
	await expect(page.getByRole('columnheader', { name: 'Inputs', exact: true })).toBeVisible();
	const cell = (code: string) => calculationCell(page, code);
	await expect(cell(inputCode)).toContainText(String(ENTERED_INPUT));
	// The step, then what the calculation publishes from it, each in its own block.
	await expect(page.getByRole('columnheader', { name: 'Steps', exact: true })).toBeVisible();
	await expect(cell(stepCode)).toContainText(String(ENTERED_INPUT + 1));
	await expect(page.getByRole('columnheader', { name: 'Outputs', exact: true })).toBeVisible();
	await expect(cell(outputCode)).toContainText(String((ENTERED_INPUT + 1) * 2));

	// The cell panel sits under the tables and opens on nothing until a cell is chosen.
	await expect(page.getByRole('heading', { name: 'No cell selected' })).toBeVisible();
	await calculationCell(page, stepCode, 0).click();
	await expect(page.getByRole('heading', { name: 'Step', exact: true })).toBeVisible();

	// How the set reaches an input is declared on the input itself (Q230), and the page then says
	// what it does between visits, before the next save rather than after it.
	await calculationCell(page, inputCode, 0).click();
	const reach = page.getByRole('combobox', { name: 'Between visits' });
	await expect(reach).toHaveValue('exact');
	await reach.selectOption('hold');
	// The toast says it too, so the page carries the line twice for a moment.
	await expect(
		page.getByText(new RegExp(`${inputCode} is held between visits`)).first(),
	).toBeVisible();
	await page.reload();
	await calculationCell(page, inputCode, 0).click();
	await expect(page.getByRole('combobox', { name: 'Between visits' })).toHaveValue('hold');

	// Opening the output puts its own fields on screen with the tables: they sit beside the formula
	// rather than a screen below the sheet.
	await calculationCell(page, outputCode, 0).click();
	for (const control of [
		page.getByRole('textbox', { name: 'Units' }),
		page.getByRole('textbox', { name: 'Curve slot' }),
		page.getByRole('combobox', { name: 'Per replicate over' }),
		page.getByRole('columnheader', { name: 'Outputs', exact: true }),
	]) {
		await expect(control).toBeInViewport();
	}

	// The site and the visit the tables read stay put wherever the author scrolls to.
	// The confirm wrapper around the button carries the role too, so both resolve.
	await page.getByRole('button', { name: 'Drop', exact: true }).last().scrollIntoViewIfNeeded();
	await expect(page.getByRole('combobox', { name: 'Visit' })).toBeInViewport();
});

// Scenario: the lab transcribes pCO2, the CNET set that carries every construct the first story
// does not: a `coalesce` fallback onto a constant, nine constants read by name, a per-replicate
// family, and a two-stage set where one output feeds another (M184, I120's audit).
//
// Expected behaviour: each construct is typed on the page, and the two outputs reproduce the
// values the portal stored at the golden visit, per replicate.
//
// The set is the first six formulas of `pco2` in `river-data-api/tests/fixtures/cnet_formula_sets.json`
// at its golden visit, VAD 2021-09-09 (row 31), both letters. The last six add no construct these
// do not: they read the `bp` step the first story already drives, and the same arithmetic.

/** The golden visit's values, the `pco2` case of the fixture. */
const PCO2_WTW_TEMP = 8.7;
const PCO2_LAB_TEMP = 22.8;
const PCO2_LAB_PRESS = 972;
const PCO2_PPM = [242.5, 241.7];
/** What the portal stored, to six significant figures. */
const PCO2_CO2_HS = ['17.9762', '17.9169'];
const PCO2_UATM = ['331.927', '330.832'];

interface Pco2Fixture {
	stamp: string;
	siteId: string;
	codes: { temp: string; labTemp: string; labPress: string; ppm: string };
}

/**
 * The catalog pCO2 reads and the visit it runs at. The `lab_co2_co2ppm` family is entered twice,
 * which is what makes the per-replicate output two values rather than one.
 */
async function seedPco2(request: APIRequestContext): Promise<Pco2Fixture> {
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
		labTemp: `lab_co2_lab_temp_${stamp}`,
		labPress: `lab_co2_lab_press_${stamp}`,
		ppm: `lab_co2_co2ppm_${stamp}`,
	};
	const project = await post('/projects', { name: `pCO2 ${stamp}` });
	const siteName = `pCO2 ${stamp}`;
	const site = await post('/sites', { name: siteName, project_id: project.id });

	const collectedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
	const readings: Array<{ parameter_id: string; value: number; time: string; replicate_index: number }> = [];
	for (const [code, values] of [
		[codes.temp, [PCO2_WTW_TEMP]],
		[codes.labTemp, [PCO2_LAB_TEMP]],
		[codes.labPress, [PCO2_LAB_PRESS]],
		[codes.ppm, PCO2_PPM],
	] as const) {
		const parameter = await post('/parameters', {
			code,
			name: code,
			category: 'measurement',
			aliases: [],
		});
		await post('/site_parameters', { site_id: site.id, parameter_id: parameter.id, name: code });
		values.forEach((value, replicate_index) =>
			readings.push({ parameter_id: parameter.id, value, time: collectedAt, replicate_index }),
		);
	}
	await post('/grab_samples', { site_id: site.id, mode: 'replace', readings });
	await post('/collection_events/stage', { site_id: site.id, collected_at: collectedAt });
	return { stamp, siteId: site.id, codes };
}

/** One step or output typed into the editor, with the family it runs over where it has one. */
async function addCell(
	page: Page,
	cell: { block: 'step' | 'output'; code: string; name: string; units: string; text: string; family?: string },
) {
	await page
		.getByRole('button', { name: cell.block === 'step' ? 'Add step' : 'Add output', exact: true })
		.click();
	await page.getByRole('textbox', { name: 'Code' }).fill(cell.code);
	await page.getByRole('textbox', { name: 'Name', exact: true }).fill(cell.name);
	await page.getByRole('textbox', { name: 'Units' }).fill(cell.units);
	await page.getByPlaceholder('Type formula directly').fill(cell.text);
	if (cell.family) {
		await page.getByLabel('Per replicate over').selectOption(cell.family);
	}
	await expect(page.locator(`td[data-sheet-row="${cell.code}"]`).first()).toBeVisible();
}

test('pCO2 is typed on the page with its constants, fallback and families, and reproduces its golden visit', async ({
	page,
	request,
}) => {
	const { stamp, siteId, codes } = await seedPco2(request);
	await signIn(page);

	await page.goto(`${BASE_PATH}/toolbox`);
	await page.getByRole('button', { name: 'New calculation' }).click();
	await page.getByRole('textbox', { name: 'Name' }).fill(`pco2_${stamp}`);
	await page.getByRole('textbox', { name: 'Label' }).fill(`pCO2 ${stamp}`);
	await page.getByRole('button', { name: 'Create and open it' }).click();
	await expect(page).toHaveURL(/\/toolbox\/[0-9a-f-]{36}/);

	// The two fallbacks: a lab reading the visit may not carry, standing in with the constant the
	// portal averages over past years.
	await addCell(page, {
		block: 'step',
		code: `lab_temp_k_${stamp}`,
		name: 'Lab temperature K',
		units: 'K',
		text: `coalesce(${codes.labTemp}, lab_temp_avg_degC) + 273.15`,
	});
	await addCell(page, {
		block: 'step',
		code: `lab_pa_${stamp}`,
		name: 'Lab pressure atm',
		units: 'atm',
		text: `coalesce(${codes.labPress} / 1013.25, lab_press_avg_atm)`,
	});

	// The per-replicate output: one value per repeat of the family it runs over.
	await addCell(page, {
		block: 'output',
		code: `CO2_HS_Um_avg_${stamp}`,
		name: 'CO2 headspace',
		units: 'uM',
		text:
			`${codes.ppm} * lab_pa_${stamp} * (vol_sa + 0.034 * exp(c_const * (1 / lab_temp_k_${stamp} - 1 / 298.15))` +
			` * vol_water * gas_const_r_atm * lab_temp_k_${stamp}) / (gas_const_r_atm * vol_water * lab_temp_k_${stamp})`,
		family: codes.ppm,
	});
	await expect(
		page.locator(`td[data-sheet-row="CO2_HS_Um_avg_${stamp}"] .sheet-replicated`).first(),
	).toBeVisible();

	await addCell(page, {
		block: 'step',
		code: `water_k_${stamp}`,
		name: 'Water temperature K',
		units: 'K',
		text: `${codes.temp} + 273.15`,
	});
	await addCell(page, {
		block: 'step',
		code: `kh_${stamp}`,
		name: 'Henry constant',
		units: '',
		text: `0.034 * exp(c_const * (1 / water_k_${stamp} - 1 / 298.15))`,
	});

	// The second stage: an output reading the output before it, per the same family.
	await addCell(page, {
		block: 'output',
		code: `pCO2_HS_uatm_avg_${stamp}`,
		name: 'pCO2 headspace',
		units: 'uatm',
		text: `CO2_HS_Um_avg_${stamp} / kh_${stamp}`,
		family: `CO2_HS_Um_avg_${stamp}`,
	});

	// Every constant the set names is an input it reads, listed beside the measured parameters.
	const inputs = block(page, 'Inputs');
	for (const name of ['lab_temp_avg_degC', 'lab_press_avg_atm', 'vol_sa', 'vol_water', 'c_const', 'gas_const_r_atm']) {
		await expect(rowOf(inputs, name)).toBeVisible();
	}

	await page.getByRole('combobox', { name: 'Site' }).selectOption(siteId);
	const visitPicker = page.getByRole('combobox', { name: 'Visit' });
	await expect(visitPicker).toBeEnabled();
	await expect(visitPicker).not.toHaveValue('');

	// Both letters, against what the portal stored for them.
	for (const [index, expected] of PCO2_CO2_HS.entries()) {
		await expect(calculationCell(page, `CO2_HS_Um_avg_${stamp}`, index + 1)).toContainText(expected);
	}
	for (const [index, expected] of PCO2_UATM.entries()) {
		await expect(calculationCell(page, `pCO2_HS_uatm_avg_${stamp}`, index + 1)).toContainText(expected);
	}
});

// Scenario: the simplest calculation there is, one input and one formula (M342). The page carries
// pCO2's intermediate table only when one is asked for.
//
// Expected behaviour: the page opens on Inputs and Outputs alone; Add output opens the formula
// for typing on the row it adds, and the one-input set computes with no Steps table drawn.
test('a one-input calculation is authored on two tables, never meeting Steps', async ({
	page,
	request,
}) => {
	const { stamp, codes } = await seedCatalog(request);
	await signIn(page);

	await page.goto(`${BASE_PATH}/toolbox`);
	await page.getByRole('button', { name: 'New calculation' }).click();
	await page.getByRole('textbox', { name: 'Name' }).fill(`single_${stamp}`);
	await page.getByRole('textbox', { name: 'Label' }).fill(`Single ${stamp}`);
	await page.getByRole('button', { name: 'Create and open it' }).click();
	await expect(page).toHaveURL(/\/toolbox\/[0-9a-f-]{36}/);

	const inputs = block(page, 'Inputs');
	await page
		.getByRole('region', { name: 'Palette' })
		.getByRole('button', { name: codes.temp, exact: true })
		.dragTo(inputs);
	await expect(block(page, 'Steps')).toHaveCount(0);

	await page.getByRole('button', { name: 'Add output', exact: true }).click();
	const formula = page.getByPlaceholder('Type formula directly');
	await expect(formula).toBeFocused();
	await formula.fill(`${codes.temp} + 273.15`);
	await page.getByRole('textbox', { name: 'Code' }).fill(`temp_k_${stamp}`);

	const outputs = block(page, 'Outputs');
	await expect(rowOf(outputs, `temp_k_${stamp}`)).toBeVisible();
	await typeInto(page, calculationCell(page, codes.temp), String(WTW_TEMP));
	await expect(calculationCell(page, codes.temp)).toContainText(String(WTW_TEMP));
	await expect(calculationCell(page, `temp_k_${stamp}`)).toContainText('280.75');
	await expect(block(page, 'Steps')).toHaveCount(0);
	await expect(page.getByRole('checkbox', { name: 'Intermediate steps' })).not.toBeChecked();
});

// Scenario: an author checks a calculation against numbers of their own at a visit that already
// holds values, typing one in place of what the visit stored.
//
// Expected behaviour: the output moves to what the typed value computes to, without a save, and
// the visit's own value is left as it was.
test('a value typed in place of the visit\'s moves the output', async ({ page, request }) => {
	const { calculationId, siteId, visitId, inputCode, outputCode } =
		await seedVisitCalculation(request);
	await page.setViewportSize({ width: 1600, height: 1080 });
	await signIn(page);
	await page.goto(`${BASE_PATH}/toolbox/${calculationId}?site=${siteId}&visit=${visitId}`);
	await expect(calculationCell(page, outputCode)).toContainText(String((ENTERED_INPUT + 1) * 2));

	const typed = 20;
	await typeInto(page, calculationCell(page, inputCode), String(typed));
	await expect(calculationCell(page, outputCode)).toContainText(String((typed + 1) * 2));

	await page.reload();
	await expect(calculationCell(page, inputCode)).toContainText(String(ENTERED_INPUT));
});

/** A site with one visit holding `value` for a fresh parameter, for a tool to be tried on. */
async function seedVisitValue(request: APIRequestContext, value: number) {
	const stamp = `${Date.now()}`;
	const bearer = await token(request);
	const headers = { Authorization: `Bearer ${bearer}` };
	const post = async (path: string, data: unknown) => {
		const response = await request.post(`${API_URL}/api${path}`, { headers, data });
		expect(response.ok(), `${path} -> ${response.status()} ${await response.text()}`).toBeTruthy();
		return response.json();
	};
	const code = `r_in_${stamp}`;
	const project = await post('/projects', { name: `R visit ${stamp}` });
	const site = await post('/sites', { name: `R visit ${stamp}`, project_id: project.id });
	const parameter = await post('/parameters', {
		code,
		name: code,
		category: 'measurement',
		aliases: [],
	});
	await post('/site_parameters', { site_id: site.id, parameter_id: parameter.id, name: code });
	const collectedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
	await post('/grab_samples', {
		site_id: site.id,
		mode: 'replace',
		readings: [{ parameter_id: parameter.id, value, time: collectedAt, replicate_index: 0 }],
	});
	await post('/collection_events/stage', { site_id: site.id, collected_at: collectedAt });
	return { stamp, code, siteId: site.id };
}

// Scenario: a calculation that needs more than formulas is authored as an R script on the same
// page, the more complicated toolsets being R run in the sidecar, and tried on another site's visit
// before anything is saved.
//
// Expected behaviour: the script is typed, the page reads what it takes and returns and declares
// both, the input is bound to the parameter a visit holds, and a run at the visit shows the output
// computed from the visit's value; a value typed over it moves the output again.
test('an R tool is authored on the page and run at a visit and on a typed value', async ({
	page,
	request,
}) => {
	const { stamp, code, siteId } = await seedVisitValue(request, 7);
	await signIn(page);
	await page.goto(`${BASE_PATH}/toolbox`);
	await page.getByRole('button', { name: 'New calculation' }).click();
	await page.getByLabel('Engine').selectOption('script');
	await page.getByRole('textbox', { name: 'Name' }).fill(`doubler_${stamp}`);
	await page.getByRole('textbox', { name: 'Label' }).fill(`Doubler ${stamp}`);
	await page.getByRole('button', { name: 'Create and open it' }).click();
	await expect(page).toHaveURL(/\/toolbox\/[0-9a-f-]{36}/);

	// Inserted rather than typed key by key: the editor closes a bracket as it is opened.
	await page.locator('.cm-content').click();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.insertText('tool <- function(inputs, constants, curves) list(y = 2 * inputs$x)');

	const detection = page
		.locator('.rounded-md')
		.filter({ has: page.getByRole('heading', { name: 'Detection' }) })
		.last();
	await expect(detection).toContainText('Parsed');
	// The input the script reads, then the output it returns, each declared from its own row.
	const add = detection.getByRole('button', { name: 'Add', exact: true });
	await expect(add).toHaveCount(2);
	await add.first().click();
	await expect(add).toHaveCount(1);
	await add.first().click();
	await expect(add).toHaveCount(0);

	// What the script calls x is what a visit holds under the seeded parameter.
	await page.getByRole('button', { name: 'More', exact: true }).first().click();
	await page.getByLabel('Reads at a visit').fill(code);
	await page.getByLabel('Reads at a visit').press('Tab');

	const preview = page.locator('details', { has: page.locator('summary', { hasText: 'Preview' }) });
	await preview.locator('summary').click();
	await preview.getByRole('combobox', { name: 'Site' }).selectOption(siteId);
	const visitPicker = preview.getByRole('combobox', { name: 'Visit' });
	await expect(visitPicker.locator('option')).toHaveCount(2);
	await visitPicker.selectOption({ index: 1 });
	const x = preview.getByRole('spinbutton', { name: 'X', exact: true });
	await expect(x).toHaveValue('7');
	await preview.getByRole('button', { name: 'Run', exact: true }).click();
	await expect(preview.getByRole('row', { name: 'y 14', exact: true })).toBeVisible();

	await x.fill('3');
	await preview.getByRole('button', { name: 'Run', exact: true }).click();
	await expect(preview.getByRole('row', { name: 'y 6', exact: true })).toBeVisible();
});

// Scenario: an author adds a step to a calculation open at a visit and types its code, then its
// formula, at the pace a person types, so the page's rerun fires between keystrokes.
//
// Expected behaviour: the half-written row is not sent to the run, so no refusal appears over the
// tables and the field keeps the keyboard.
test('a step and an output typed at a person\'s pace are not run until they are written', async ({ page, request }) => {
	const { calculationId, siteId, visitId, inputCode } = await seedVisitCalculation(request);
	const ownership: string[] = [];
	page.on('console', (message) => {
		if (message.text().includes('ownership_invalid_mutation')) ownership.push(message.text());
	});
	await page.setViewportSize({ width: 1600, height: 1080 });
	await signIn(page);
	await page.goto(`${BASE_PATH}/toolbox/${calculationId}?site=${siteId}&visit=${visitId}`);
	await expect(calculationCell(page, inputCode)).toContainText(String(ENTERED_INPUT));

	await page.getByRole('button', { name: 'Add step', exact: true }).first().click();
	const code = page.getByRole('textbox', { name: 'Code' });
	await code.click();
	// Past the page's 400 ms settle, so every pause is a run.
	await code.pressSequentially('typed_step', { delay: 500 });
	await expect(code).toBeFocused();
	await expect(code).toHaveValue('typed_step');
	await page.getByPlaceholder('Type formula directly').pressSequentially(`${inputCode} +`, { delay: 50 });
	await page.waitForTimeout(1000);
	await expect(page.getByText('Invalid formula')).toHaveCount(0);
	await page.getByPlaceholder('Type formula directly').pressSequentially(' 3');
	await expect(calculationCell(page, 'typed_step')).toContainText(String(ENTERED_INPUT + 3));
	await expect(page.getByText('Invalid formula')).toHaveCount(0);

	// An output goes the same way, and nothing above the tables moves under the author while a
	// name is half typed and the formula does not yet parse.
	const outputs = page.getByRole('region', { name: 'Outputs', exact: true });
	const top = async () => (await outputs.boundingBox())?.y;
	await page.getByRole('button', { name: 'Add output', exact: true }).click();
	await code.click();
	const settled = await top();
	await code.pressSequentially('typed_output', { delay: 500 });
	await expect(code).toBeFocused();
	await expect(code).toHaveValue('typed_output');
	expect(await top()).toBe(settled);
	const formula = page.getByPlaceholder('Type formula directly');
	// Reaching the formula field scrolls the page to it, as it would for a person.
	await formula.click();
	const typing = await top();
	for (const ch of 'typed_step *') {
		await page.keyboard.type(ch);
		await page.waitForTimeout(450);
		expect(await top()).toBe(typing);
	}
	await expect(page.getByText('Invalid formula')).toHaveCount(0);
	await formula.pressSequentially(' 2');
	await expect(calculationCell(page, 'typed_output')).toContainText(String((ENTERED_INPUT + 3) * 2));
	await expect(page.getByText('Invalid formula')).toHaveCount(0);
	expect(await top()).toBe(typing);
	expect(ownership).toEqual([]);
});
