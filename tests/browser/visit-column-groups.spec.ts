import { expect, test, type APIRequestContext } from '@playwright/test';
import { API_URL, BASE_PATH, postGrab, signIn, token } from './portal';
import { frozenButton, headerButton, sheetCell, typeInto } from './sheet';

// Scenario: a site whose parameter is measured in triplicate. Expected behaviour: the Visits table
// shows one column holding the served value, and the parameter's own header opens it to the three
// repeats behind it, without a second fetch.

let seeded = 0;

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
	if (!unmeasured) await postGrab(post, {
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
		await postGrab(post, {
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
	await expect(page.getByText('1 visit', { exact: true })).toBeVisible();

	// Collapsed, the group is one column holding the mean of the three.
	const header = headerButton(page, { name: code, exact: true });
	await expect(header).toHaveAttribute('aria-expanded', 'false');
	await expect(sheetCell(page, new RegExp(`^${code} at`))).toHaveText(/^12/);

	// The header opens it to one column per repeat, and the neighbour keeps its single column.
	await header.click();
	await expect(header).toHaveAttribute('aria-expanded', 'true');
	for (const [index, value] of ['10', '12', '14'].entries()) {
		await expect(sheetCell(page, new RegExp(`^${code} repeat ${index + 1} at`))).toHaveText(value);
	}
	await expect(sheetCell(page, /^groups_one_\w* at/)).toHaveText('4.2');

	// And folds back.
	await header.click();
	await expect(header).toHaveAttribute('aria-expanded', 'false');
	await expect(sheetCell(page, new RegExp(`^${code} repeat 3`))).toHaveCount(0);
});

test('a cell is typed in place and one Save writes every visit it touched', async ({
	page,
	request,
}) => {
	const { siteId, emptyCode } = await seedVisit(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('1 visit', { exact: true })).toBeVisible();

	// Nothing has moved, so there is nothing to save.
	const save = page.getByRole('button', { name: /^Save \d+ value/ });
	await expect(save).toBeDisabled();

	// Every value is a cell of the sheet, not a text box inside one.
	await expect(page.locator('.ht_master td input')).toHaveCount(0);

	// A correction on a stored value, and an entry in a slot the visit never held.
	await typeInto(page, /^groups_one_\w* at/, '4.8');
	await expect(save).toContainText('Save 1 value');
	// A correction is screened against the site's history like an entry (Q262).
	await expect(save).toBeDisabled();

	await typeInto(page, new RegExp(`^${emptyCode} at`), '7.5');
	await expect(save).toContainText('Save 2 values');

	// The entry and the correction are screened together before the save will open.
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

	// Both came back from the store, and the visit's record still opens on its date, where the
	// fill count has moved with the new measurement.
	await expect(sheetCell(page, /^groups_one_\w* at/)).toHaveText('4.8');
	await expect(sheetCell(page, new RegExp(`^${emptyCode} at`))).toHaveText('7.5');
	await frozenButton(page, { name: /./ }).first().click();
	await expect(page.getByText(/3\/3 parameters filled · /)).toBeVisible();
});

test('the keyboard walks the sheet: Tab along a visit, Enter down to the next date', async ({
	page,
	request,
}) => {
	const { siteId, emptyCode } = await seedVisit(request, 2);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('2 visits', { exact: true })).toBeVisible();

	// Columns run in code order, so the unmeasured slot comes before the one measured once.
	await sheetCell(page, new RegExp(`^${emptyCode} at`)).first().click();
	await page.keyboard.press('Tab');
	await page.keyboard.type('4.9');
	await page.keyboard.press('Enter');
	await page.keyboard.type('4.7');
	await page.keyboard.press('Enter');

	const single = sheetCell(page, /^groups_one_\w* at/);
	await expect(single.nth(0)).toHaveText('4.9');
	await expect(single.nth(1)).toHaveText('4.7');
	await expect(page.getByRole('button', { name: /^Save \d+ value/ })).toContainText('Save 2 values');

	// Undo takes the last keystroke back, and the store's value with it.
	await page.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(single.nth(1)).toHaveText('4.4');
	await expect(page.getByRole('button', { name: /^Save \d+ value/ })).toContainText('Save 1 value');
});

test('a column pasted from a sheet fills one visit per line', async ({ page, request }) => {
	const { siteId } = await seedVisit(request, 2);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('2 visits', { exact: true })).toBeVisible();

	// A block pasted at the first date fills down the dates listed under it, and the third line
	// lands in the spare area, where it holds a value with no date to open a visit at.
	await sheetCell(page, /^groups_one_\w* at/).first().click();
	await page.evaluate(() => {
		const data = new DataTransfer();
		data.setData('text/plain', '5.1\n5.2\n5.3');
		(document.activeElement ?? document).dispatchEvent(
			new ClipboardEvent('paste', { clipboardData: data, bubbles: true }),
		);
	});

	const single = sheetCell(page, /^groups_one_\w* at/);
	await expect(single.nth(0)).toHaveText('5.1');
	await expect(single.nth(1)).toHaveText('5.2');
	await expect(page.getByText(/1 new row holds values with no date/)).toBeVisible();
	await expect(page.getByRole('button', { name: /^Save \d+ value/ })).toContainText('Save 2 values');
});

test("the fill handle copies a value down the dates below it", async ({ page, request }) => {
	const { siteId, emptyCode } = await seedVisit(request, 2);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('2 visits', { exact: true })).toBeVisible();

	const cells = sheetCell(page, new RegExp(`^${emptyCode} at`));
	await typeInto(page, cells.nth(0), '3.1');
	// Enter moved the selection down; a second click here would read as a double-click and edit.
	await page.keyboard.press('ArrowUp');

	// The handle sits on the selection's corner; dragging it onto the next date fills that cell.
	const handle = page.locator('.ht_master .wtBorder.current.corner');
	await expect(handle).toBeVisible();
	const from = await handle.boundingBox();
	const to = await cells.nth(1).boundingBox();
	if (!from || !to) throw new Error('the handle and the cell are not laid out');
	await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
	await page.mouse.down();
	await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 5 });
	await page.mouse.up();

	await expect(cells.nth(1)).toHaveText('3.1');
	await expect(page.getByRole('button', { name: /^Save \d+ value/ })).toContainText('Save 2 values');
});

test('a visit is withdrawn from its own record and the withdrawal taken back', async ({
	page,
	request,
}) => {
	const { siteId } = await seedVisit(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('1 visit', { exact: true })).toBeVisible();

	await frozenButton(page, { name: /./ }).first().click();
	await page.getByRole('button', { name: 'Withdraw this visit' }).click();

	// A withdrawal is a reversible stamp, and the confirmation says so before it is taken.
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText('reversible stamp, not a delete');
	await expect(dialog).toContainText('4 readings will be withdrawn');
	await dialog.getByRole('button', { name: 'Withdraw', exact: true }).click();
	await expect(dialog).toBeHidden();

	// And it is taken back from the same record, with the readings re-asserted.
	const undo = page.getByRole('button', { name: 'Undo the withdrawal' });
	await expect(undo).toBeVisible();
	await undo.click();
	await expect(undo).toBeHidden();
});

test('a cleared cell withdraws its replicate, and the withdrawal survives a reload', async ({
	page,
	request,
}) => {
	const { siteId, code } = await seedVisit(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('1 visit', { exact: true })).toBeVisible();

	// The first of the three repeats is cleared and a fourth entered, so the group is rewritten
	// without it; the single measurement is cleared on its own.
	await headerButton(page, { name: code, exact: true }).click();
	await headerButton(page, { name: `One repeat more for ${code}` }).click();
	await sheetCell(page, new RegExp(`^${code} repeat 1 at`)).click();
	await page.keyboard.press('Delete');
	await typeInto(page, new RegExp(`^${code} repeat 4 at`), '16');
	await sheetCell(page, /^groups_one_\w* at/).click();
	await page.keyboard.press('Delete');
	const save = page.getByRole('button', { name: /^Save \d+ value/ });
	await expect(save).toContainText('Save 3 values');
	await page.getByRole('button', { name: 'Check against site history' }).click();
	await save.click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText('2 withdrawn');
	await expect(dialog).toContainText('reversible stamp, not a delete');
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(dialog).toBeHidden();

	// The store serves the group without its first repeat, and marks what was withdrawn.
	await headerButton(page, { name: code, exact: true }).click();
	const mean = sheetCell(page, new RegExp(`^${code} at`));
	await expect(mean).toHaveText(/^14/);
	await expect(mean.locator('.sheet-mark', { hasText: '†' })).toBeVisible();

	await page.reload();
	await expect(page.getByText('1 visit', { exact: true })).toBeVisible();
	await expect(mean.locator('.sheet-mark', { hasText: '†' })).toBeVisible();
	await expect(sheetCell(page, /^groups_one_\w* at/)).toHaveClass(/sheet-struck/);
	await headerButton(page, { name: code, exact: true }).click();
	await expect(sheetCell(page, new RegExp(`^${code} repeat 1 at`))).toHaveClass(/sheet-struck/);
	await expect(sheetCell(page, new RegExp(`^${code} repeat 2 at`))).not.toHaveClass(/sheet-struck/);
});

test('a value nobody may type opens its record on a double-click', async ({ page, request }) => {
	const { siteId, code } = await seedVisit(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('1 visit', { exact: true })).toBeVisible();

	// The collapsed triplicate is a mean, which is not typed, so the cell opens what is behind it.
	await sheetCell(page, new RegExp(`^${code} at`)).dblclick();
	await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();
	await expect(page.getByText(/\d+\/\d+ parameters filled · /)).toBeVisible();
});

test("a group's plus adds the column a fourth measurement needs", async ({ page, request }) => {
	const { siteId, code } = await seedVisit(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('1 visit', { exact: true })).toBeVisible();

	await headerButton(page, { name: code, exact: true }).click();
	const fourth = sheetCell(page, new RegExp(`^${code} repeat 4 at`));
	await expect(fourth).toHaveCount(0);

	// The plus widens the group; the value then has a slot to go in.
	await headerButton(page, { name: `One repeat more for ${code}` }).click();
	await typeInto(page, new RegExp(`^${code} repeat 4 at`), '16');
	const save = page.getByRole('button', { name: /^Save \d+ value/ });
	await expect(save).toContainText('Save 1 value');
	await page.getByRole('button', { name: 'Check against site history' }).click();
	await save.click();
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(fourth).toHaveText('16');

	// The minus stops at what the store holds, so a stored repeat is not taken off the table.
	for (let i = 0; i < 3; i += 1) {
		await headerButton(page, { name: `One repeat fewer for ${code}` }).click();
	}
	await expect(fourth).toHaveText('16');
});

test("the visit's record declares what measured a parameter, and the value carries it", async ({
	page,
	request,
}) => {
	const { siteId, code } = await seedVisit(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('1 visit', { exact: true })).toBeVisible();

	// The declaration is on the visit's own record, beside the parameter it is about.
	await frozenButton(page, { name: /./ }).first().click();
	const picker = page.getByRole('combobox', {
		name: 'Instrument for Triplicate parameter at this visit',
	});
	await expect(picker).toHaveValue('');
	const options = await picker.locator('option').all();
	expect(options.length, 'the register has instruments to choose from').toBeGreaterThan(1);
	await picker.selectOption({ index: 1 });

	// A repeat entered under it saves, and the column keeps what was typed.
	await headerButton(page, { name: code, exact: true }).click();
	await headerButton(page, { name: `One repeat more for ${code}` }).click();
	await typeInto(page, new RegExp(`^${code} repeat 4 at`), '16');
	await page.getByRole('button', { name: 'Check against site history' }).click();
	await page.getByRole('button', { name: /^Save \d+ value/ }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(sheetCell(page, new RegExp(`^${code} repeat 4 at`))).toHaveText('16');
});

test('an empty visit is discarded from its own record', async ({ page, request }) => {
	const { siteId } = await seedVisit(request, 1, true);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('1 visit', { exact: true })).toBeVisible();

	await frozenButton(page, { name: /./ }).first().click();
	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: 'Discard this visit' }).click();
	await expect(page.getByText('No visits recorded for this site.')).toBeVisible();
});

// Scenario: a value is typed into the grid and another tab of the site is chosen before Save.
// Expected behaviour: the page asks first; declining keeps the grid and what was typed, and
// accepting leaves it.
test('leaving the visits tab with a typed value asks first', async ({ page, request }) => {
	const { siteId } = await seedVisit(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('1 visit', { exact: true })).toBeVisible();
	await typeInto(page, /^groups_one_\w* at/, '4.8');
	const save = page.getByRole('button', { name: /^Save \d+ value/ });
	await expect(save).toContainText('Save 1 value');

	const asked: string[] = [];
	page.once('dialog', (dialog) => {
		asked.push(dialog.message());
		void dialog.dismiss();
	});
	await page.getByRole('button', { name: 'Charts', exact: true }).click();
	expect(asked).toEqual(['These new values are not saved yet. Leave anyway?']);
	await expect(save).toContainText('Save 1 value');
	await expect(sheetCell(page, /^groups_one_\w* at/)).toHaveText('4.8');

	page.once('dialog', (dialog) => void dialog.accept());
	await page.getByRole('button', { name: 'Charts', exact: true }).click();
	await expect(save).toBeHidden();
});
