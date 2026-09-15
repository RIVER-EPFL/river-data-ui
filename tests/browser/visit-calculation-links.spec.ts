import { expect, test, type APIRequestContext } from '@playwright/test';
import { BASE_PATH, signIn } from './portal';

// Scenario: a computed row in the entry grid. Q44 requires the tool form and the grid to write the
// same visit and stay in step, and M52 requires the save to say what it will move before it moves.
//
// Expected behaviour: the entry bar names each output and what it holds today while the values are
// typed; the row header opens the calculation at this visit with the visit's values already loaded;
// and the cell marker opens the point record without leaving the grid.

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3005';
const KEYCLOAK_URL = process.env.E2E_KEYCLOAK_URL ?? 'http://localhost:8180/';

const ENTERED = 10;
const CURVE_SLOT = 'corr';

interface Fixture {
	eventId: string;
	siteName: string;
	calculation: string;
	inputName: string;
	outputName: string;
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
		await post('/site_parameters', { site_id: site.id, parameter_id: parameterId, name: code });
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
	const derived = await post('/derived_parameters', {
		code: outputName,
		name: outputName,
		units: '',
		formula: `${inputName} * 2`,
		tool_script_id: script.id,
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

	return { eventId: staged.id, siteName, calculation, inputName, outputName };
}

test('the save says what each output holds before it moves it', async ({ page, request }) => {
	const { eventId, calculation, outputName } = await seedComputedVisit(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/visits/${eventId}`);

	await page.getByTestId('grid-cell-0-0').fill('12');

	// The consequence is on the entry bar while the values are typed, so it is read before the
	// save form is opened rather than inside it.
	await expect(
		page.getByText(`${calculation} rewrites ${outputName} (now ${ENTERED * 2})`),
	).toBeVisible();

	// Typing over a stored value is a correction, not an entry, so no seasonal check gates it.
	await page.getByRole('button', { name: /^Save .*value/ }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText('1 value will be written');
	await dialog.getByRole('button', { name: 'Cancel' }).click();
});

test('a computed row opens its calculation at this visit, and its point record in place', async ({
	page,
	request,
}) => {
	const { eventId, siteName, calculation, inputName, outputName } = await seedComputedVisit(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/visits/${eventId}`);

	// The marker opens the record beside the row rather than navigating away.
	const outputRow = page.getByRole('row', { name: new RegExp(`^${outputName}`) });
	await outputRow.getByTestId('provenance-marker').click();
	const record = page.getByRole('button', { name: 'Close' });
	await expect(record).toBeVisible();
	await expect(page).toHaveURL(new RegExp(`/visits/${eventId}$`));
	await record.click();
	await expect(record).toBeHidden();

	// The row header opens the calculation with this visit staged and what it reads loaded.
	await outputRow.getByRole('button', { name: `computed by ${calculation}` }).click();
	await expect(page).toHaveURL(new RegExp(`/tools\\?tool=${calculation}`));
	await expect(page.getByText('Field visit')).toBeVisible();
	await expect(page.getByText(siteName).first()).toBeVisible();
	await expect(page.getByRole('spinbutton', { name: inputName })).toHaveValue(String(ENTERED));

	await page.getByRole('spinbutton', { name: inputName }).fill('14');
	await page.getByRole('button', { name: 'Calculate', exact: true }).click();

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
	await page.goto(`${BASE_PATH}/visits/${eventId}`);
	await expect(page.getByTestId('grid-cell-0-0')).toHaveValue('14');
	await expect(page.getByRole('row', { name: new RegExp(`^${outputName}`) })).toContainText('28');
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
		await post('/site_parameters', { site_id: site.id, parameter_id: parameterId, name: code });
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
	const derived = await post('/derived_parameters', {
		code: outputName,
		name: outputName,
		units: '',
		formula: `${inputName} * curve_slope + curve_intercept`,
		curve_slot: CURVE_SLOT,
		tool_script_id: script.id,
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

	return { eventId: staged.id, calculation, outputName, curveName };
}

// Scenario: a calculation whose formula corrects with a standard curve, already run at this visit.
//
// Expected behaviour (Q192): the row header reopens it on that run, so the curve the run chose is
// in the picker rather than an empty one, and the form says where it came from.
test('the row header reopens a calculation on the curve its last run here used', async ({
	page,
	request,
}) => {
	const { eventId, calculation, outputName, curveName } = await seedCurveRun(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/visits/${eventId}`);

	const outputRow = page.getByRole('row', { name: new RegExp(`^${outputName}`) });
	await outputRow.getByRole('button', { name: `computed by ${calculation}` }).click();

	await expect(page).toHaveURL(new RegExp(`/tools\\?tool=${calculation}&reload=`));
	await expect(page.getByText('Opened with the curve this visit’s last run used.')).toBeVisible();
	await expect(page.getByRole('combobox', { name: `${CURVE_SLOT} curve` })).toHaveValue(
		/[0-9a-f-]{36}/,
	);
	await expect(page.getByRole('combobox', { name: `${CURVE_SLOT} curve` })).toContainText(curveName);
});
