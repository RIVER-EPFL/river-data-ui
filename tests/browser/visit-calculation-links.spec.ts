import { expect, test, type APIRequestContext } from '@playwright/test';
import { BASE_PATH, signIn } from './portal';

// Scenario: a computed row in the entry grid. Q44 requires the tool form and the grid to write the
// same visit and stay in step, and M52 requires the save to say what it will move before it moves.
//
// Expected behaviour: the save's confirmation names each output and what it holds today; the row
// header opens the calculation at this visit with the visit's values already loaded; and the cell
// marker opens the point record without leaving the grid.

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3005';
const KEYCLOAK_URL = process.env.E2E_KEYCLOAK_URL ?? 'http://localhost:8180/';

const ENTERED = 10;

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

	const parameters: Record<string, string> = {};
	for (const [ordinal, [code, role]] of [
		[inputName, 'measured'],
		[outputName, 'output'],
	].entries()) {
		const parameter = await post('/parameters', {
			code,
			name: code,
			category: 'measurement',
			aliases: [],
		});
		parameters[code] = parameter.id;
		await post('/parameter_group_members', {
			group_id: group.id,
			parameter_id: parameter.id,
			role,
			ordinal,
		});
		await post('/site_parameters', { site_id: site.id, parameter_id: parameter.id, name: code });
	}

	const script = await post('/tool_scripts', {
		name: calculation,
		label: calculation,
		engine: 'formula',
		parameter_group_id: group.id,
	});
	await post('/derived_parameters', {
		code: outputName,
		name: outputName,
		units: '',
		formula: `${inputName} * 2`,
		tool_script_id: script.id,
		ordinal: 1,
	});

	const collectedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
	await post('/grab_samples', {
		site_id: site.id,
		mode: 'replace',
		readings: [
			{
				parameter_id: parameters[inputName],
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
	await page.getByRole('button', { name: /^Save .*value/ }).click();

	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText(`${calculation} rewrites ${outputName} (now ${ENTERED * 2})`);
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
});
