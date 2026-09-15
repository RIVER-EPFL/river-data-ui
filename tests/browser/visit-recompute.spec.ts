import { expect, test, type APIRequestContext } from '@playwright/test';
import { BASE_PATH, signIn } from './portal';

// Scenario: a scientist corrects an input in the visits table and the calculation that reads it is
// queued by the save. The table is still open in front of them.
//
// Expected behaviour: the output cell holds the recomputed number without the page being reloaded.
// The chain runs as a tracked job, so the value arrives after the save's response, and a table that
// reads the visit once is showing the old number.

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3005';
const KEYCLOAK_URL = process.env.E2E_KEYCLOAK_URL ?? 'http://localhost:8180/';

const ENTERED = 10;
const CORRECTED = 15;

interface Fixture {
	siteId: string;
	eventId: string;
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

	const inputName = `t102_in_${stamp}`;
	const outputName = `t102_out_${stamp}`;
	const project = await post('/projects', { name: `Recompute ${stamp}` });
	const site = await post('/sites', { name: `Recompute ${stamp}`, project_id: project.id });
	const group = await post('/parameter_groups', {
		code: `recompute_${stamp}`,
		label: `Recompute ${stamp}`,
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

	const calculation = await post('/tool_scripts', {
		name: `recompute_${stamp}`,
		label: `Recompute ${stamp}`,
		engine: 'formula',
		parameter_group_id: group.id,
	});
	const derived = await post('/derived_parameters', {
		code: outputName,
		name: outputName,
		units: '',
		formula: `${inputName} * 2`,
		tool_script_id: calculation.id,
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

	// The save queued the chain; the story starts from a settled visit, so wait for the first run.
	await expect
		.poll(
			async () => {
				const detail = await call('get', `/collection_events/${staged.id}/detail`);
				const output = detail.cells.find(
					(c: { parameter_code: string }) => c.parameter_code === outputName,
				);
				return output?.served_value ?? null;
			},
			{ message: 'the calculation writes its output at the seeded visit', timeout: 30_000 },
		)
		.toBe(ENTERED * 2);

	return { siteId: site.id, eventId: staged.id, inputName, outputName };
}

test('a corrected input shows its recomputed output without a reload', async ({ page, request }) => {
	const { siteId, inputName, outputName } = await seedComputedVisit(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('1 visit')).toBeVisible();

	// The output has its own column, holding what the calculation wrote.
	const output = page.getByRole('button', { name: new RegExp(`^${String(ENTERED * 2)}\\b`) });
	await expect(output).toBeVisible();

	// The input is corrected in place. The output's column is a calculation's, so it takes no
	// keystroke and stays a read-only cell.
	const cell = page.getByRole('textbox', { name: new RegExp(`^${inputName}`) });
	await expect(cell).toHaveValue(String(ENTERED));
	await cell.fill(String(CORRECTED));

	const save = page.getByRole('button', { name: /^Save \d+ value/ });
	await save.click();
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(dialog).toBeHidden();

	// Nothing is reloaded: the table is the same page it was, with the recomputed output in it.
	await expect(page.getByRole('textbox', { name: new RegExp(`^${inputName}`) })).toHaveValue(
		String(CORRECTED),
	);
	await expect
		.poll(
			async () =>
				page.getByRole('button', { name: new RegExp(`^${String(CORRECTED * 2)}\\b`) }).count(),
			{ message: `${outputName} is recomputed in place`, timeout: 30_000 },
		)
		.toBeGreaterThan(0);
});
