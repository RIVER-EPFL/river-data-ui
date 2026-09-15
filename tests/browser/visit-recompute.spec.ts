import { expect, test, type APIRequestContext } from '@playwright/test';
import { BASE_PATH, signIn } from './portal';

// Scenario: a scientist corrects an input in the entry grid and the calculation that reads it is
// queued by the save. The grid is still open in front of them.
//
// Expected behaviour: the output cell holds the recomputed number without the page being reloaded.
// The chain runs as a tracked job, so the value arrives after the save's response, and a grid that
// reads the visit once is showing the old number.

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3005';
const KEYCLOAK_URL = process.env.E2E_KEYCLOAK_URL ?? 'http://localhost:8180/';

const ENTERED = 10;
const CORRECTED = 15;

interface Fixture {
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

	const calculation = await post('/tool_scripts', {
		name: `recompute_${stamp}`,
		label: `Recompute ${stamp}`,
		engine: 'formula',
		parameter_group_id: group.id,
	});
	await post('/derived_parameters', {
		code: outputName,
		name: outputName,
		units: '',
		formula: `${inputName} * 2`,
		tool_script_id: calculation.id,
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

	return { eventId: staged.id, inputName, outputName };
}

test('a corrected input shows its recomputed output without a reload', async ({ page, request }) => {
	const { eventId, inputName, outputName } = await seedComputedVisit(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/visits/${eventId}`);

	// The input row names the output in its "what this feeds" marker, so the row is found by the
	// parameter it opens with.
	const outputRow = page.getByRole('row', { name: new RegExp(`^${outputName}`) });
	await expect(outputRow).toContainText(`computed by`);
	await expect(outputRow).toContainText(String(ENTERED * 2));

	// The input is corrected in the grid. Its row is the only editable one.
	const cell = page.getByTestId('grid-cell-0-0');
	await expect(cell).toHaveValue(String(ENTERED));
	await cell.fill(String(CORRECTED));

	const save = page.getByRole('button', { name: /^Save .*value/ });
	await save.click();
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(dialog).toBeHidden();

	// Nothing is reloaded: the grid is the same page it was before the save.
	await expect(page.getByTestId('grid-cell-0-0')).toHaveValue(String(CORRECTED));
	await expect(outputRow).toContainText(String(CORRECTED * 2));

	// The run is on the page rather than left to be noticed: the bar says what moved, and the
	// output that a calculation rewrote is marked on its own row.
	await expect(page.getByText(/calculation ran/)).toBeVisible();
	await expect(outputRow.getByTestId('cell-recomputed')).toBeVisible();

	// The visit's calculations are done, so it carries no recompute badge. The queued and running
	// states it passes through are not asserted: a run this small can finish inside one poll.
	await expect(page.getByText('recomputing')).toHaveCount(0);
	await expect(page.getByText('queued')).toHaveCount(0);
});
