import { expect, test, type APIRequestContext } from '@playwright/test';
import { API_URL, BASE_PATH, saveFormulaSet, signIn, token } from './portal';
import { frozenButton, sheetCell, typeInto } from './sheet';

// Scenario: a computed row in the entry grid. Q44 requires the tool form and the grid to write the
// same visit and stay in step, and M52 requires the save to say what it will move before it moves.
//
// Expected behaviour: the entry bar names each output and what it holds today while the values are
// typed; the row header opens the calculation at this visit with the visit's values already loaded;
// and the cell marker opens the point record without leaving the grid.

const ENTERED = 10;
const CURVE_SLOT = 'corr';

interface Fixture {
	siteId: string;
	eventId: string;
	siteName: string;
	calculation: string;
	inputName: string;
	outputName: string;
}

/** A visit holding one entered value and one output a formula calculation writes from it. */
async function seedComputedVisit(request: APIRequestContext): Promise<Fixture> {
	const stamp = `${Date.now()}`;
	const bearer = await token(request);
	const headers = { Authorization: `Bearer ${bearer}` };
	const call = async (method: 'post' | 'get', path: string, data?: unknown) => {
		const response = await request[method](`${API_URL}/api${path}`, { headers, data });
		expect(response.ok(), `${path} -> ${response.status()} ${await response.text()}`).toBeTruthy();
		return response.json();
	};
	const post = (path: string, data: unknown) => call('post', path, data);

	const inputName = `t106_in_${stamp}`;
	const outputName = `t106_out_${stamp}`;
	const calculation = `t106_${stamp}`;
	const siteName = `Links ${stamp}`;
	const project = await post('/projects', { name: siteName });
	const site = await post('/sites', { name: siteName, project_id: project.id });
	const group = await post('/parameter_groups', {
		code: calculation,
		label: siteName,
		ordinal: 1,
	});

	// The calculation mints its own output parameter (Q183), so only the input is declared here.
	const declare = async (parameterId: string, code: string, role: string, ordinal: number) => {
		await post('/parameter_group_members', {
			group_id: group.id,
			parameter_id: parameterId,
			role,
			ordinal,
		});
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

	const collectedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
	await post('/grab_samples', {
		site_id: site.id,
		mode: 'replace',
		readings: [
			{
				parameter_id: input.id,
				value: ENTERED,
				time: collectedAt,
				replicate_index: 0,
			},
		],
	});
	const staged = await post('/collection_events/stage', {
		site_id: site.id,
		collected_at: collectedAt,
	});

	await expect
		.poll(
			async () => {
				const detail = await call('get', `/collection_events/${staged.id}/detail`);
				return (
					detail.cells.find((c: { parameter_code: string }) => c.parameter_code === outputName)
						?.served_value ?? null
				);
			},
			{ message: 'the calculation writes its output at the seeded visit', timeout: 30_000 },
		)
		.toBe(ENTERED * 2);

	return { siteId: site.id, eventId: staged.id, siteName, calculation, inputName, outputName };
}

test('the save says what each output holds before it moves it', async ({ page, request }) => {
	const { siteId, calculation, inputName, outputName } = await seedComputedVisit(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('1 visit', { exact: true })).toBeVisible();

	await typeInto(page, new RegExp(`^${inputName} at`), '12');

	// Typing over a stored value is a correction, not an entry, so no seasonal check gates it, and
	// the save says what it will rewrite before it does.
	await page.getByRole('button', { name: /^Save \d+ value/ }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText('1 value will be written');
	await expect(dialog).toContainText(`${calculation} rewrites ${outputName} (now ${ENTERED * 2})`);
	await dialog.getByRole('button', { name: 'Cancel' }).click();
});

// Scenario: a computed reading at a field visit, walked back to what produced it.
//
// Expected behaviour: the reading's record opens its visit on that parameter, its tool run names
// the calculation version that ran and opens it, and both the run card and Edit reopen Data entry
// on the run itself, staged at the run's own visit rather than the one chosen before.
test('a computed reading opens its visit, its run and version, and reopens that run at its own visit', async ({
	page,
	request,
}) => {
	const first = await seedComputedVisit(request);
	await new Promise((resolve) => setTimeout(resolve, 1_100));
	const second = await seedComputedVisit(request);
	await signIn(page);

	// The first visit is chosen at Data entry through its record's calculation chip.
	await page.goto(`${BASE_PATH}/sites/${first.siteId}?tab=visits`);
	await expect(page.getByText('1 visit', { exact: true })).toBeVisible();
	await frozenButton(page, { name: /./ }).first().click();
	await page
		.getByRole('row')
		.filter({ hasText: first.outputName })
		.getByRole('button', { name: first.calculation, exact: true })
		.click();
	await expect(page).toHaveURL(/\/data-entry\?/);

	// The second visit's output is walked from its own reading.
	await page.goto(`${BASE_PATH}/sites/${second.siteId}?tab=visits`);
	await expect(page.getByText('1 visit', { exact: true })).toBeVisible();
	await sheetCell(page, new RegExp(`^${second.outputName} at`)).dblclick();
	const actions = page.getByRole('group', { name: 'Actions' }).first();

	await actions.getByRole('link', { name: 'Open visit' }).click();
	await expect(page).toHaveURL(
		new RegExp(`/sites/${second.siteId}\\?tab=visits&event=${second.eventId}&parameter=`),
	);
	await expect(page.getByRole('group', { name: 'Actions' }).first()).toBeVisible();

	await page.getByText('Details').first().click();
	await page.getByRole('button', { name: 'Show tool run' }).first().click();
	await page.getByRole('link', { name: /^Version \d+$/ }).first().click();
	await expect(page).toHaveURL(new RegExp(`/toolbox/${second.calculation}\\?version=\\d+`));

	await page.goBack();
	await expect(page.getByRole('group', { name: 'Actions' }).first()).toBeVisible();
	await actions.getByRole('button', { name: 'Edit', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByText('Reopen the calculation').click();
	await dialog.getByRole('button', { name: 'Open the calculation' }).click();

	await expect(page).toHaveURL(new RegExp(`/data-entry\\?tool=${second.calculation}&reload=`));
	await expect(page.getByRole('spinbutton', { name: second.inputName })).toHaveValue(String(ENTERED));
	await expect(page.getByText(new RegExp(`in place of ${first.siteName}`))).toBeVisible();
	const staged = await page.evaluate(() => sessionStorage.getItem('river-data-staged-visit'));
	expect(JSON.parse(staged ?? '{}').siteId, 'the save lands at the run\u2019s own visit').toBe(
		second.siteId,
	);

	await page.goto(`${BASE_PATH}/sites/${second.siteId}?tab=visits`);
	await expect(page.getByText('1 visit', { exact: true })).toBeVisible();
	await sheetCell(page, new RegExp(`^${second.outputName} at`)).dblclick();
	await page.getByText('Details').first().click();
	await page.getByRole('button', { name: 'Show tool run' }).first().click();
	await page.getByRole('button', { name: 'Reload into tool' }).first().click();
	await expect(page).toHaveURL(new RegExp(`/data-entry\\?tool=${second.calculation}&reload=`));
	await expect(page.getByRole('spinbutton', { name: second.inputName })).toHaveValue(String(ENTERED));
});

test('a computed row opens its calculation at this visit, and its point record in place', async ({
	page,
	request,
}) => {
	const { siteId, siteName, calculation, inputName, outputName } = await seedComputedVisit(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('1 visit', { exact: true })).toBeVisible();
	await frozenButton(page, { name: /./ }).first().click();

	// The record opens below the grid rather than navigating away.
	const outputRow = page.getByRole('row').filter({ hasText: outputName });
	await outputRow.getByRole('button', { name: outputName }).click();
	const record = page.getByRole('button', { name: 'Close' });
	await expect(record).toBeVisible();
	await expect(page).toHaveURL(new RegExp(`tab=visits`));
	await record.click();
	await expect(record).toBeHidden();

	// The calculation chip opens it with this visit chosen and what it reads loaded.
	await outputRow.getByRole('button', { name: calculation, exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/data-entry\\?tool=${calculation}`));
	await expect(page.getByText('Field visit')).toBeVisible();
	await expect(page.getByText(siteName).first()).toBeVisible();
	await expect(page.getByRole('spinbutton', { name: inputName })).toHaveValue(String(ENTERED));

	await page.getByRole('spinbutton', { name: inputName }).fill('14');
	await expect(page.getByRole('button', { name: 'Check against site history' })).toBeVisible();

	// The check is on the bar beside the results, so it is satisfied before the save form opens.
	await page.getByRole('button', { name: 'Check against site history' }).click();
	await expect(page.getByRole('button', { name: 'Re-check' })).toBeVisible();

	await page.getByRole('button', { name: 'Save to Site', exact: true }).click();
	const save = page.getByRole('dialog');
	// The typed-over input is a measurement of this visit, so the save carries it as a correction
	// of what the visit holds and the stored output is computed from a value the grid shows.
	await expect(save).toContainText(`corrects ${inputName} ${ENTERED} to 14`);
	await save.getByRole('button', { name: 'Save', exact: true }).click();
	await save.getByRole('button', { name: 'Replace existing' }).click();
	await expect(save).toBeHidden();
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(sheetCell(page, new RegExp(`^${inputName} at`))).toHaveText('14');
	await expect(sheetCell(page, new RegExp(`^${outputName} at`))).toHaveText(/^28\b/);
});

/**
 * A visit whose calculation reads a standard curve, already run once with one chosen. A formula
 * naming a curve slot is skipped until a curve is supplied, so the first run is made here rather
 * than left to the chain, and the visit then holds the output whose row header reopens it.
 */
async function seedCurveRun(request: APIRequestContext) {
	const stamp = `${Date.now()}`;
	const bearer = await token(request);
	const headers = { Authorization: `Bearer ${bearer}` };
	const post = async (path: string, data: unknown) => {
		const response = await request.post(`${API_URL}/api${path}`, { headers, data });
		expect(response.ok(), `${path} -> ${response.status()} ${await response.text()}`).toBeTruthy();
		return response.json();
	};

	const inputName = `t120_in_${stamp}`;
	const outputName = `t120_out_${stamp}`;
	const calculation = `t120_${stamp}`;
	const siteName = `Curve ${stamp}`;
	const project = await post('/projects', { name: siteName });
	const site = await post('/sites', { name: siteName, project_id: project.id });
	const group = await post('/parameter_groups', { code: calculation, label: siteName, ordinal: 1 });

	// The calculation mints its own output parameter (Q183), so only the input is declared here.
	const declare = async (parameterId: string, code: string, role: string, ordinal: number) => {
		await post('/parameter_group_members', {
			group_id: group.id,
			parameter_id: parameterId,
			role,
			ordinal,
		});
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

	const instrument = await post('/sensors', {
		name: `Bench ${stamp}`,
		serial_number: `T120-${stamp}`,
	});
	const curveName = `Curve ${stamp}`;
	const curve = await post('/standard_curves', {
		sensor_id: instrument.id,
		name: curveName,
		slope: 3,
		intercept: 1,
	});

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
		formula: `${inputName} * curve_slope + curve_intercept`,
		curve_slot: CURVE_SLOT,
		ordinal: 1,
	});
	await declare(derived.output_parameter_id, outputName, 'output', 1);

	const collectedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
	await post('/grab_samples', {
		site_id: site.id,
		mode: 'replace',
		readings: [
			{
				parameter_id: input.id,
				value: ENTERED,
				time: collectedAt,
				replicate_index: 0,
			},
		],
	});
	const staged = await post('/collection_events/stage', {
		site_id: site.id,
		collected_at: collectedAt,
	});

	const run = await post(`/tools/${calculation}/calculate`, {
		site_id: site.id,
		collected_at: collectedAt,
		[inputName]: ENTERED,
		[CURVE_SLOT]: { standard_curve_id: curve.id },
	});
	await post('/grab_samples', {
		site_id: site.id,
		mode: 'replace',
		tool_run_id: run.run_id,
		readings: [
			{
				parameter_id: derived.output_parameter_id,
				value: ENTERED * 3 + 1,
				time: collectedAt,
				replicate_index: 0,
				output: outputName,
			},
		],
	});

	return { siteId: site.id, eventId: staged.id, calculation, outputName, curveName };
}

// Scenario: a calculation whose formula corrects with a standard curve, already run at this visit.
//
// Expected behaviour (Q192): the row header reopens it on that run, so the curve the run chose is
// in the picker rather than an empty one, and the form says where it came from.
test('the row header reopens a calculation on the curve its last run here used', async ({
	page,
	request,
}) => {
	const { siteId, calculation, outputName, curveName } = await seedCurveRun(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('1 visit', { exact: true })).toBeVisible();
	await frozenButton(page, { name: /./ }).first().click();

	const outputRow = page.getByRole('row').filter({ hasText: outputName });
	await outputRow.getByRole('button', { name: calculation, exact: true }).click();

	await expect(page).toHaveURL(new RegExp(`/data-entry\\?tool=${calculation}&reload=`));
	await expect(page.getByText('Opened with the curve this visit’s last run used.')).toBeVisible();
	await expect(page.getByRole('combobox', { name: `${CURVE_SLOT} curve` })).toHaveValue(
		/[0-9a-f-]{36}/,
	);
	await expect(page.getByRole('combobox', { name: `${CURVE_SLOT} curve` })).toContainText(curveName);
});

/** A visit holding one measurement entered raw with the standard curve that corrects it. */
async function seedCorrectedVisit(request: APIRequestContext) {
	const stamp = `${Date.now()}`;
	const bearer = await token(request);
	const headers = { Authorization: `Bearer ${bearer}` };
	const post = async (path: string, data: unknown) => {
		const response = await request.post(`${API_URL}/api${path}`, { headers, data });
		expect(response.ok(), `${path} -> ${response.status()} ${await response.text()}`).toBeTruthy();
		return response.json();
	};

	const code = `b469_${stamp}`;
	const siteName = `Corrected ${stamp}`;
	const project = await post('/projects', { name: siteName });
	const site = await post('/sites', { name: siteName, project_id: project.id });
	const parameter = await post('/parameters', {
		code,
		name: code,
		category: 'measurement',
		aliases: [],
	});
	await post('/site_parameters', {
		site_id: site.id,
		parameter_id: parameter.id,
		name: code,
		cadence: 'low',
	});
	const instrument = await post('/sensors', { name: `Plate ${stamp}`, serial_number: `B469-${stamp}` });
	const curveName = `Curve ${stamp}`;
	const curve = await post('/standard_curves', {
		sensor_id: instrument.id,
		name: curveName,
		slope: 3,
		intercept: 1,
	});
	const collectedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
	await post('/grab_samples', {
		site_id: site.id,
		mode: 'replace',
		readings: [
			{
				parameter_id: parameter.id,
				value: ENTERED,
				time: collectedAt,
				replicate_index: 0,
				sensor_id: instrument.id,
				standard_curve_id: curve.id,
			},
		],
	});
	await post('/collection_events/stage', { site_id: site.id, collected_at: collectedAt });
	return { siteId: site.id, code, curveName };
}

// Scenario: a measurement corrected with a standard curve, read on the Visits grid.
//
// Expected behaviour (Q97): the cell names the curve on hover without the visit being opened.
test('a corrected cell names its curve on the grid', async ({ page, request }) => {
	const { siteId, code, curveName } = await seedCorrectedVisit(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('1 visit', { exact: true })).toBeVisible();

	const corrected = sheetCell(page, new RegExp(`^${code} at`));
	await expect(corrected).toHaveAttribute('title', new RegExp(`Corrected with ${curveName}`));
	await expect(corrected.locator('.sheet-mark', { hasText: /^c$/ })).toHaveAttribute(
		'title',
		`Corrected with ${curveName}`,
	);
});

// Scenario: a value a formula calculation computed through a standard curve, read on the Visits
// grid.
//
// Expected behaviour (Q268): the cell names the curve on hover as the one it was computed with,
// apart from a curve that corrected a measurement, and the visit's slot table names it with the
// coefficients the run used.
test('a computed cell names the curve its calculation used', async ({ page, request }) => {
	const { siteId, outputName, curveName } = await seedCurveRun(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('1 visit', { exact: true })).toBeVisible();

	const computed = sheetCell(page, new RegExp(`^${outputName} at`));
	await expect(computed).toHaveAttribute('title', new RegExp(`Computed with ${curveName}`));
	await expect(computed.locator('.sheet-mark', { hasText: /^f$/ })).toHaveAttribute(
		'title',
		`Computed with ${curveName}`,
	);
	await expect(computed.locator('.sheet-mark', { hasText: /^c$/ })).toHaveCount(0);

	await frozenButton(page, { name: /./ }).first().click();
	const slotRow = page.locator('tr').filter({ hasText: outputName }).filter({ hasText: 'computed with' });
	await expect(slotRow).toContainText(`computed with ${curveName} (y = 3x + 1)`);
});

// Scenario: a selection on the Visits grid, whose read-only cells Handsontable paints itself.
//
// Expected behaviour: the cell a calculation connects to the selection is tinted over the read-only
// background, and the grid takes the brand's colours rather than Handsontable's defaults.
test('the grid draws its cell states and the brand colours over its own read-only styling', async ({
	page,
	request,
}) => {
	const { siteId, inputName, outputName } = await seedComputedVisit(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('1 visit', { exact: true })).toBeVisible();

	await sheetCell(page, new RegExp(`^${inputName} at`)).click();
	const output = sheetCell(page, new RegExp(`^${outputName} at`));
	await expect(output).toHaveClass(/sheet-read/);
	await expect(output).toHaveClass(/htDimmed/);
	const background = (el: Element) => getComputedStyle(el).backgroundColor;
	const readOnly = await page.locator('.ht_master td.htDimmed:not([class*="sheet-read"])').first().evaluate(background);
	expect(await output.evaluate(background), 'the connection tint shows on a read-only cell').not.toBe(readOnly);

	const [accent, primary] = await page.evaluate(() => [
		getComputedStyle(document.querySelector('.sheet-grid .ht-theme-classic')!).getPropertyValue('--ht-accent-color').trim(),
		getComputedStyle(document.documentElement).getPropertyValue('--color-brand-primary').trim(),
	]);
	expect(accent).toBe(primary);
});
