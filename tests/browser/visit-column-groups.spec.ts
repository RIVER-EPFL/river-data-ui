import { expect, test, type APIRequestContext } from '@playwright/test';
import { BASE_PATH, signIn } from './portal';

// Scenario: a site whose parameter is measured in triplicate. Expected behaviour: the Visits table
// shows one column holding the served value, and the parameter's own header opens it to the three
// repeats behind it, without a second fetch.

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3005';
const KEYCLOAK_URL = process.env.E2E_KEYCLOAK_URL ?? 'http://localhost:8180/';

let seeded = 0;

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

/** A site holding one triplicate parameter, one measured once, and one slot with no reading. */
async function seedVisit(
	request: APIRequestContext,
	visits = 1,
	unmeasured = false,
): Promise<{ siteId: string; code: string; emptyCode: string }> {
	const stamp = `${Date.now()}_${(seeded += 1)}`;
	const headers = { Authorization: `Bearer ${await token(request)}` };
	const post = async (path: string, data: unknown) => {
		const response = await request.post(`${API_URL}/api${path}`, { headers, data });
		expect(response.ok(), `${path} -> ${response.status()} ${await response.text()}`).toBeTruthy();
		return response.json();
	};

	const project = await post('/projects', { name: `Groups ${stamp}` });
	const site = await post('/sites', { name: `Groups ${stamp}`, project_id: project.id });
	const code = `groups_trip_${stamp}`;
	const triplicate = await post('/parameters', {
		code,
		name: 'Triplicate parameter',
		category: 'measurement',
		aliases: [],
	});
	const single = await post('/parameters', {
		code: `groups_one_${stamp}`,
		name: 'Single parameter',
		category: 'measurement',
		aliases: [],
	});
	const emptyCode = `groups_empty_${stamp}`;
	const empty = await post('/parameters', {
		code: emptyCode,
		name: 'Unmeasured parameter',
		category: 'measurement',
		aliases: [],
	});
	for (const parameter of [triplicate, single, empty]) {
		await post('/site_parameters', {
			site_id: site.id,
			parameter_id: parameter.id,
			name: parameter.name,
		});
	}

	const collectedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
	if (!unmeasured) await post('/grab_samples', {
		site_id: site.id,
		mode: 'replace',
		readings: [
			{ parameter_id: triplicate.id, value: 10, time: collectedAt, replicate_index: 0 },
			{ parameter_id: triplicate.id, value: 12, time: collectedAt, replicate_index: 1 },
			{ parameter_id: triplicate.id, value: 14, time: collectedAt, replicate_index: 2 },
			{ parameter_id: single.id, value: 4.2, time: collectedAt, replicate_index: 0 },
		],
	});
	await post('/collection_events/stage', { site_id: site.id, collected_at: collectedAt });

	// A second field day, so the keyboard has a date to wrap to.
	for (let day = 1; day < visits; day += 1) {
		const earlier = new Date(Date.parse(collectedAt) - day * 86_400_000)
			.toISOString()
			.replace(/\.\d+Z$/, 'Z');
		await post('/grab_samples', {
			site_id: site.id,
			mode: 'replace',
			readings: [
				{ parameter_id: single.id, value: 4.4, time: earlier, replicate_index: 0 },
			],
		});
		await post('/collection_events/stage', { site_id: site.id, collected_at: earlier });
	}
	return { siteId: site.id, code, emptyCode };
}

test("a parameter's header opens its column to the repeats behind it", async ({
	page,
	request,
}) => {
	const { siteId, code } = await seedVisit(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('1 visit')).toBeVisible();

	// Collapsed, the group is one column holding the mean of the three.
	const header = page.getByRole('button', { name: new RegExp(`^${code}`) });
	await expect(header).toHaveAttribute('aria-expanded', 'false');
	await expect(page.getByRole('button', { name: /^12\b/ })).toBeVisible();

	// The header opens it to one column per repeat, and the neighbour keeps its single column.
	await header.click();
	await expect(header).toHaveAttribute('aria-expanded', 'true');
	for (const [index, value] of ['10', '12', '14'].entries()) {
		await expect(
			page.getByRole('textbox', { name: new RegExp(`^${code} repeat ${index + 1}`) }),
		).toHaveValue(value);
	}
	await expect(page.getByRole('textbox', { name: /^groups_one_/ })).toHaveValue('4.2');

	// And folds back.
	await header.click();
	await expect(header).toHaveAttribute('aria-expanded', 'false');
	await expect(page.getByRole('textbox', { name: new RegExp(`^${code} repeat 3`) })).toBeHidden();
});

test('a cell is typed in place and one Save writes every visit it touched', async ({
	page,
	request,
}) => {
	const { siteId, code, emptyCode } = await seedVisit(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('1 visit')).toBeVisible();

	// Nothing has moved, so there is nothing to save.
	const save = page.getByRole('button', { name: /^Save \d+ value/ });
	await expect(save).toBeDisabled();

	// A correction on a stored value, and an entry in a slot the visit never held.
	await page.getByRole('textbox', { name: /^groups_one_/ }).fill('4.8');
	await expect(save).toContainText('Save 1 value');
	// A correction moves a value the site already holds, so nothing is screened for it.
	await expect(save).toBeEnabled();

	await page.getByRole('textbox', { name: new RegExp(`^${emptyCode}`) }).fill('7.5');
	await expect(save).toContainText('Save 2 values');

	// An entry is screened against the site's history before the save will open.
	await expect(save).toBeDisabled();
	await page.getByRole('button', { name: 'Check against site history' }).click();
	await expect(save).toBeEnabled();

	await save.click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText('2 values will be written');
	await expect(dialog).toContainText('1 corrected in place');
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(save).toBeDisabled();

	// Both came back from the store, and the fill count moved with the new measurement.
	await expect(page.getByRole('textbox', { name: /^groups_one_/ })).toHaveValue('4.8');
	await expect(page.getByRole('textbox', { name: new RegExp(`^${emptyCode}`) })).toHaveValue('7.5');
	await expect(page.getByText('3/3')).toBeVisible();
});

test('Tab runs the whole visit row and wraps to the next date', async ({ page, request }) => {
	const { siteId, code, emptyCode } = await seedVisit(request, 2);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('2 visits', { exact: true })).toBeVisible();

	// Collapsed, the row is one cell per parameter and Tab walks them left to right, the portal's
	// orientation, not one parameter's repeats. Columns run in code order, so the unmeasured slot
	// comes before the one measured once.
	await page.locator('#visit-cell-0-0').focus();
	await page.keyboard.press('Tab');
	await expect(page.locator('#visit-cell-0-1')).toBeFocused();

	// The triplicate is collapsed over a mean, which is nobody's to type, so Tab crosses it and
	// wraps to the first cell of the next date rather than into the statistics.
	await page.keyboard.press('Tab');
	await expect(page.locator('#visit-cell-1-0')).toBeFocused();

	// Opening the group puts its repeats in the row, and the arrows move between them.
	await page.getByRole('button', { name: new RegExp(`^${code}`) }).click();
	await page.locator('#visit-cell-0-2').focus();
	await page.keyboard.press('ArrowRight');
	await expect(page.locator('#visit-cell-0-3')).toBeFocused();

	// Down moves to the same slot on the next date, so a column reads as one series.
	await page.keyboard.press('ArrowDown');
	await expect(page.locator('#visit-cell-1-3')).toBeFocused();
});

test('a column of dates pasted from a sheet fills one visit per line', async ({ page, request }) => {
	const { siteId } = await seedVisit(request, 2);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('2 visits', { exact: true })).toBeVisible();

	// A block pasted at the first date fills down the dates listed under it, and the third line
	// has no visit to land on.
	await page.locator('#visit-cell-0-1').focus();
	await page.evaluate(() => {
		const input = document.querySelector<HTMLInputElement>('#visit-cell-0-1')!;
		const data = new DataTransfer();
		data.setData('text/plain', '5.1\n5.2\n5.3');
		input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
	});

	await expect(page.locator('#visit-cell-0-1')).toHaveValue('5.1');
	await expect(page.locator('#visit-cell-1-1')).toHaveValue('5.2');
	await expect(page.getByText(/ran past the visits listed/)).toBeVisible();
	await expect(page.getByRole('button', { name: /^Save \d+ value/ })).toContainText('Save 2 values');
});

test('a visit is withdrawn from its own row and the withdrawal taken back', async ({
	page,
	request,
}) => {
	const { siteId } = await seedVisit(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('1 visit')).toBeVisible();

	await page.locator('button[title="Expand this visit"]').click();
	await page.getByRole('button', { name: 'Withdraw this visit' }).click();

	// A withdrawal is a reversible stamp, and the confirmation says so before it is taken.
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText('reversible stamp, not a delete');
	await expect(dialog).toContainText('4 readings will be withdrawn');
	await dialog.getByRole('button', { name: 'Withdraw', exact: true }).click();
	await expect(dialog).toBeHidden();

	// And it is taken back from the same row, with the readings re-asserted.
	const undo = page.getByRole('button', { name: 'Undo the withdrawal' });
	await expect(undo).toBeVisible();
	await undo.click();
	await expect(undo).toBeHidden();
});

test("a group's plus adds the column a fourth measurement needs", async ({ page, request }) => {
	const { siteId, code } = await seedVisit(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('1 visit')).toBeVisible();

	await page.getByRole('button', { name: new RegExp(`^${code}`) }).click();
	await expect(page.locator('#visit-cell-0-5')).toHaveCount(0);

	// The plus widens the group; the value then has a slot to go in.
	await page.getByRole('button', { name: `One repeat more for ${code}` }).click();
	await page.locator('#visit-cell-0-5').fill('16');
	const save = page.getByRole('button', { name: /^Save \d+ value/ });
	await expect(save).toContainText('Save 1 value');
	await page.getByRole('button', { name: 'Check against site history' }).click();
	await save.click();
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(page.locator('#visit-cell-0-5')).toHaveValue('16');

	// The minus stops at what the store holds, so a stored repeat is not taken off the table.
	for (let i = 0; i < 3; i += 1) {
		await page.getByRole('button', { name: `One repeat fewer for ${code}` }).click();
	}
	await expect(page.locator('#visit-cell-0-5')).toHaveValue('16');
});

test('the expanded row declares what measured a parameter, and the value carries it', async ({
	page,
	request,
}) => {
	const { siteId, code } = await seedVisit(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('1 visit')).toBeVisible();

	// The declaration is on the visit's own record, beside the parameter it is about.
	await page.locator('button[title="Expand this visit"]').click();
	const picker = page.getByRole('combobox', {
		name: 'Instrument for Triplicate parameter at this visit',
	});
	await expect(picker).toHaveValue('');
	const options = await picker.locator('option').all();
	expect(options.length, 'the register has instruments to choose from').toBeGreaterThan(1);
	await picker.selectOption({ index: 1 });

	// A repeat entered under it saves, and the column keeps what was typed.
	await page.getByRole('button', { name: new RegExp(`^${code}`) }).click();
	await page.getByRole('button', { name: `One repeat more for ${code}` }).click();
	await page.locator('#visit-cell-0-5').fill('16');
	await page.getByRole('button', { name: 'Check against site history' }).click();
	await page.getByRole('button', { name: /^Save \d+ value/ }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(page.locator('#visit-cell-0-5')).toHaveValue('16');
});

test('an empty visit is discarded from its own row', async ({ page, request }) => {
	const { siteId } = await seedVisit(request, 1, true);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('1 visit')).toBeVisible();

	await page.locator('button[title="Expand this visit"]').click();
	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: 'Discard this visit' }).click();
	await expect(page.getByText('No visits recorded for this site.')).toBeVisible();
});
