import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { API_URL, BASE_PATH, KEYCLOAK_URL, postGrab, saveFormulaSet, signIn, token } from './portal';
import { sheetCell, typeInto } from './sheet';

// Scenario: an intern opens a field day, which stands pending until a manager rules on it (Q177).
// Expected behaviour: the manager finds it under the Visits page's pending view and verifies it
// there, and the visit is no longer pending.

async function tokenFor(request: APIRequestContext, username: string): Promise<string> {
	const response = await request.post(
		`${KEYCLOAK_URL.replace(/\/$/, '')}/realms/river-data/protocol/openid-connect/token`,
		{
			form: {
				client_id: 'river-data-ui-local',
				username,
				password: username,
				grant_type: 'password',
			},
		},
	);
	expect(response.ok(), `the seeded realm issues a token for ${username}`).toBeTruthy();
	return (await response.json()).access_token;
}

function subject(jwt: string): string {
	return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).sub;
}

type Headers = Record<string, string>;

async function call(
	request: APIRequestContext,
	method: 'post' | 'put' | 'get',
	path: string,
	headers: Headers,
	data?: unknown,
) {
	const response = await request[method](`${API_URL}/api${path}`, {
		headers,
		data,
	});
	expect(response.ok(), `${path} -> ${response.status()} ${await response.text()}`).toBeTruthy();
	return response.json();
}

/** Add a project to what a seeded realm user is granted, keeping what they held. */
async function grant(
	request: APIRequestContext,
	admin: Headers,
	username: string,
	projectId: string,
) {
	const grantsPath = `/users/${subject(await tokenFor(request, username))}/grants`;
	const held = (await call(request, 'get', grantsPath, admin)) as Array<
		{ project_id?: string } | string
	>;
	const projectIds = held.map((g) => (typeof g === 'string' ? g : (g.project_id ?? '')));
	await call(request, 'put', grantsPath, admin, {
		project_ids: [...projectIds.filter(Boolean), projectId],
	});
}

async function seedPendingVisit(
	request: APIRequestContext,
): Promise<{ siteName: string; siteId: string; visitId: string }> {
	const stamp = `${Date.now()}`;
	const admin = { Authorization: `Bearer ${await token(request)}` };
	const siteName = `Pending field day ${stamp}`;
	const project = await call(request, 'post', '/projects', admin, {
		name: siteName,
	});
	const site = await call(request, 'post', '/sites', admin, {
		name: siteName,
		project_id: project.id,
	});
	await grant(request, admin, 'intern1', project.id);

	const intern = await tokenFor(request, 'intern1');
	const visit = await call(
		request,
		'post',
		'/collection_events/stage',
		{ Authorization: `Bearer ${intern}` },
		{ site_id: site.id, collected_at: '2024-03-07T10:00:00Z' },
	);
	expect(visit.unverified, 'an intern opens the field day pending').toBe(true);
	return { siteName, siteId: site.id, visitId: visit.id };
}

/** A project's station declaring one entered input and one output a formula doubles it into. */
async function seedCalculatedStation(request: APIRequestContext) {
	const stamp = `${Date.now()}`;
	const admin = { Authorization: `Bearer ${await token(request)}` };
	const post = (path: string, data: unknown) => call(request, 'post', path, admin, data);
	const inputName = `sty1_in_${stamp}`;
	const outputName = `sty1_out_${stamp}`;
	const siteName = `Intern field day ${stamp}`;
	const project = await post('/projects', { name: `STY1 ${stamp}` });
	const site = await post('/sites', { name: siteName, project_id: project.id });
	const group = await post('/parameter_groups', {
		code: `sty1_${stamp}`,
		label: siteName,
		ordinal: 1,
	});
	const declare = async (parameterId: string, code: string, role: string, ordinal: number) => {
		await post('/parameter_group_members', {
			group_id: group.id,
			parameter_id: parameterId,
			role,
			ordinal,
		});
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
		name: `sty1_${stamp}`,
		label: siteName,
		engine: 'formula',
		parameter_group_id: group.id,
	});
	const derived = await saveFormulaSet(request, admin, script.id, {
		code: outputName,
		name: outputName,
		units: '',
		formula: `${inputName} * 2`,
		ordinal: 1,
	});
	await declare(derived.output_parameter_id, outputName, 'output', 1);
	await grant(request, admin, 'intern1', project.id);
	await grant(request, admin, 'manager1', project.id);
	return { admin, siteId: site.id, siteName, inputName, outputName };
}

// Scenario: STY1. An intern enters a field day as one row of the site's grid and sees what it
// computes to as they type; the project's manager then approves it.
// Expected behaviour: the intern's save stands pending, and once the manager verifies the field
// day and then the value entered in it, its computed output is served.
test('an intern enters a field day in the grid and the project manager verifies it', async ({
	page,
	request,
}) => {
	const { admin, siteId, siteName, inputName, outputName } = await seedCalculatedStation(request);

	await signIn(page, 'intern1', 'intern1');
	await page.goto(`${BASE_PATH}/events`);
	await page.getByRole('button', { name: 'New visit' }).click();
	const opening = page.getByRole('dialog');
	await opening.locator('#nv-site-0').selectOption(siteId);
	await opening.getByLabel('Date and time, row 1').fill('2025-06-15T09:00');
	await opening.getByRole('button', { name: 'Add visit' }).click();
	await opening.getByRole('link', { name: 'Open the visit' }).click();
	await expect(page).toHaveURL(new RegExp(`/sites/${siteId}\\?tab=visits`));

	const input = sheetCell(page, new RegExp(`^${inputName} at`));
	const output = sheetCell(page, new RegExp(`^${outputName} at`));
	await typeInto(page, input, '7');
	await expect(output).toHaveText(/^14\b/);
	await expect(output).toHaveAttribute('title', /not saved yet/);

	await page.getByRole('button', { name: 'Check against site history' }).click();
	const save = page.getByRole('button', { name: /^Save \d+ value/ });
	await expect(save).toBeEnabled();
	await save.click();
	const saving = page.getByRole('dialog');
	await saving.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(saving).toBeHidden();

	const listed = async () =>
		(
			(await call(request, 'get', `/visits?site_id=${siteId}`, admin)).items as Array<{
				id: string;
				unverified: boolean;
			}>
		)[0];
	const entered = await listed();
	expect(entered.unverified, "the intern's field day stands pending").toBe(true);

	await page.context().clearCookies();
	await signIn(page, 'manager1', 'manager1');
	await page.goto(`${BASE_PATH}/events`);
	await page.getByRole('button', { name: 'Pending verification' }).click();
	// The field day first: an entry in it is refused a ruling until the visit stands.
	const fieldDay = page.getByRole('row', { name: new RegExp(`${siteName}.*field day pending`) });
	await fieldDay.getByText(siteName).click();
	await page.locator('button', { hasText: 'Verify the field day' }).click();
	await page.getByRole('button', { name: 'Verify', exact: true }).click();
	await expect(fieldDay).toHaveCount(0);

	const entry = page.getByRole('row', {
		name: new RegExp(`${siteName}.*entered, unverified ${inputName}`),
	});
	await entry.getByText(siteName).click();
	await page.getByRole('button', { name: 'Verify', exact: true }).first().click();
	await page.getByRole('button', { name: 'Verify', exact: true }).last().click();
	await expect(entry).toHaveCount(0);

	expect((await listed()).unverified, 'the field day is verified').toBe(false);
	const served = async () => {
		const detail = await call(request, 'get', `/collection_events/${entered.id}/detail`, admin);
		return (
			detail.cells.find((c: { parameter_code: string }) => c.parameter_code === outputName)
				?.served_value ?? null
		);
	};
	await expect.poll(served, { message: 'the verified output is served', timeout: 30_000 }).toBe(14);
});

test('a manager verifies an intern field day from the Visits page', async ({ page, request }) => {
	const { siteName, siteId, visitId } = await seedPendingVisit(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/events`);

	await page.getByRole('button', { name: 'Pending verification' }).click();
	const row = page.getByRole('row', { name: new RegExp(siteName) });
	await expect(row).toBeVisible();
	await row.getByText(siteName).click();

	await page.locator('button', { hasText: 'Verify the field day' }).click();
	await page.getByRole('button', { name: 'Verify', exact: true }).click();
	await expect(row).toHaveCount(0);

	const visits = await request.get(`${API_URL}/api/visits?site_id=${siteId}`, {
		headers: { Authorization: `Bearer ${await token(request)}` },
	});
	expect(visits.ok(), `visits -> ${visits.status()}`).toBeTruthy();
	const [visit] = (await visits.json()).items as Array<{
		id: string;
		unverified: boolean;
	}>;
	expect(visit.id).toBe(visitId);
	expect(visit.unverified, 'the field day is no longer pending').toBe(false);
});

/** A station whose calculation adds two entered inputs, with an intern's visit entered there. */
async function seedEnteredVisit(request: APIRequestContext, label: string) {
	const stamp = `${Date.now()}`;
	const admin = { Authorization: `Bearer ${await token(request)}` };
	const post = (path: string, data: unknown) => call(request, 'post', path, admin, data);
	const siteName = `STY2 ${label} ${stamp}`;
	const [aName, bName, outputName] = ['a', 'b', 'sum'].map((p) => `sty2_${p}_${stamp}`);
	const project = await post('/projects', { name: siteName });
	const site = await post('/sites', { name: siteName, project_id: project.id });
	const group = await post('/parameter_groups', {
		code: `sty2_${stamp}`,
		label: siteName,
		ordinal: 1,
	});
	const declare = async (parameterId: string, code: string, role: string, ordinal: number) => {
		await post('/parameter_group_members', {
			group_id: group.id,
			parameter_id: parameterId,
			role,
			ordinal,
		});
		await post('/site_parameters', {
			site_id: site.id,
			parameter_id: parameterId,
			name: code,
			cadence: 'low',
		});
	};
	const inputs: Record<string, string> = {};
	for (const [ordinal, code] of [aName, bName].entries()) {
		const parameter = await post('/parameters', {
			code,
			name: code,
			category: 'measurement',
			aliases: [],
		});
		await declare(parameter.id, code, 'measured', ordinal);
		inputs[code] = parameter.id;
	}
	const script = await post('/tool_scripts', {
		name: `sty2_${stamp}`,
		label: siteName,
		engine: 'formula',
		parameter_group_id: group.id,
	});
	const derived = await saveFormulaSet(request, admin, script.id, {
		code: outputName,
		name: outputName,
		units: '',
		formula: `${aName} + ${bName}`,
		ordinal: 1,
	});
	await declare(derived.output_parameter_id, outputName, 'output', 2);
	await grant(request, admin, 'intern1', project.id);
	await grant(request, admin, 'manager1', project.id);

	const collectedAt = '2025-06-15T09:00:00Z';
	const intern = { Authorization: `Bearer ${await tokenFor(request, 'intern1')}` };
	await call(request, 'post', '/collection_events/stage', intern, {
		site_id: site.id,
		collected_at: collectedAt,
	});
	await postGrab((path, data) => call(request, 'post', path, intern, data), {
		site_id: site.id,
		readings: [
			{ parameter_id: inputs[aName], value: 3, time: collectedAt },
			{ parameter_id: inputs[bName], value: 4, time: collectedAt },
		],
	});

	const cell = async (parameterId: string) => {
		const visits = (await call(request, 'get', `/sites/${site.id}/visits`, admin)).visits as Array<{
			cells: Array<{
				parameter_id: string;
				value?: number;
				n_unverified?: number;
				withdrawn?: boolean;
			}>;
		}>;
		return visits[0]?.cells.find((c) => c.parameter_id === parameterId) ?? null;
	};
	const outputId = derived.output_parameter_id as string;
	await expect
		.poll(async () => (await cell(outputId))?.value ?? null, {
			message: 'the chain computes the output from the pending entries',
			timeout: 30_000,
		})
		.toBe(7);

	// The field day stands first (Q177); the story is about the values entered in it.
	const manager = { Authorization: `Bearer ${await tokenFor(request, 'manager1')}` };
	const pending = (
		await call(
			request,
			'get',
			'/sync/replicate_audit_holds?status=pending&kind=unverified_visit&page_size=500',
			manager,
		)
	).holds as Array<{ id: string; site_id: string }>;
	const fieldDay = pending.find((h) => h.site_id === site.id);
	expect(fieldDay, 'the intern field day is pending').toBeTruthy();
	await call(request, 'post', `/sync/replicate_audit_holds/${fieldDay!.id}/resolve`, manager, {
		mode: 'verify',
	});

	return { siteName, aName, bName, outputName, outputId, inputs, cell };
}

/** Open an intern's pending entry in the Visits page's pending view. */
async function openEntry(page: Page, siteName: string, inputName: string) {
	const entry = page.getByRole('row', {
		name: new RegExp(`${siteName}.*entered, unverified ${inputName}`),
	});
	await entry.getByText(siteName).click();
	return entry;
}

// Scenario: STY2. A manager rules on each value an intern entered, one cell at a time.
// Expected behaviour: the output computed from two entries stays held while one of them is
// pending and is released with the last; before a reject the manager is shown the output it
// takes, and the reject withdraws the entry and that output together.
test('a manager rules on an intern entry by entry and the computed output follows', async ({
	page,
	request,
}) => {
	const verified = await seedEnteredVisit(request, 'verify');
	const rejected = await seedEnteredVisit(request, 'reject');

	await signIn(page, 'manager1', 'manager1');
	await page.goto(`${BASE_PATH}/events`);
	await page.getByRole('button', { name: 'Pending verification' }).click();

	const verify = async (siteName: string, inputName: string) => {
		const entry = await openEntry(page, siteName, inputName);
		await page.getByRole('button', { name: 'Verify', exact: true }).first().click();
		await page.getByRole('button', { name: 'Verify', exact: true }).last().click();
		await expect(entry).toHaveCount(0);
	};

	await verify(verified.siteName, verified.aName);
	expect(
		(await verified.cell(verified.outputId))?.n_unverified,
		'one input is still pending, so the output is held',
	).toBeGreaterThan(0);

	await verify(verified.siteName, verified.bName);
	await expect
		.poll(async () => (await verified.cell(verified.outputId))?.n_unverified ?? null, {
			message: 'the last input verified releases the output',
		})
		.toBe(0);
	await expect(
		page.getByRole('row', { name: new RegExp(`${verified.siteName}.*${verified.outputName}`) }),
		'the released output leaves the queue',
	).toHaveCount(0);

	const entry = await openEntry(page, rejected.siteName, rejected.aName);
	await expect(page.getByText('A reject also withdraws what was computed from it:')).toBeVisible();
	await expect(page.getByRole('listitem').filter({ hasText: rejected.outputName })).toContainText(
		'= 7',
	);
	await page.getByRole('button', { name: 'Reject', exact: true }).first().click();
	await expect(page.getByText(new RegExp(`also withdraws 1 computed value: ${rejected.outputName}`))).toBeVisible();
	await page.getByRole('button', { name: 'Reject', exact: true }).last().click();
	await expect(entry).toHaveCount(0);

	await expect
		.poll(async () => (await rejected.cell(rejected.inputs[rejected.aName]))?.withdrawn ?? null, {
			message: 'the rejected entry is withdrawn',
		})
		.toBe(true);
	expect(
		(await rejected.cell(rejected.outputId))?.withdrawn,
		'the output computed from it goes with it',
	).toBe(true);
});
