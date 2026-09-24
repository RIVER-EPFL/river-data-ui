import { expect, test, type APIRequestContext } from '@playwright/test';
import { API_URL, BASE_PATH, postGrab, signIn, token } from './portal';
import { frozenButton, frozenCell, frozenDate, sheetCell, typeInto } from './sheet';

// Scenario: a field day is pasted into the Visits table from a spreadsheet, under the last visit
// the site holds. Expected behaviour: the dated rows stage their own visits, say so before Save,
// and one Save writes both the visits and the values on them.

let seeded = 0;

/** A site holding one spot parameter and one visit, so the spare area starts under a row. */
async function seedSite(
	request: APIRequestContext,
): Promise<{ siteId: string; code: string; standing: string }> {
	const stamp = `${Date.now()}_${(seeded += 1)}`;
	const headers = { Authorization: `Bearer ${await token(request)}` };
	const post = async (path: string, data: unknown) => {
		const response = await request.post(`${API_URL}/api${path}`, { headers, data });
		expect(response.ok(), `${path} -> ${response.status()} ${await response.text()}`).toBeTruthy();
		return response.json();
	};

	const project = await post('/projects', { name: `Spare ${stamp}` });
	const site = await post('/sites', { name: `Spare ${stamp}`, project_id: project.id });
	const code = `spare_${stamp}`;
	const parameter = await post('/parameters', {
		code,
		name: 'Spare parameter',
		category: 'measurement',
		aliases: [],
	});
	await post('/site_parameters', {
		site_id: site.id,
		parameter_id: parameter.id,
		name: 'Spare parameter',
	});

	const standing = new Date(Date.now() - 30 * 86_400_000).toISOString().replace(/\.\d+Z$/, 'Z');
	await postGrab(post, {
		site_id: site.id,
		mode: 'replace',
		readings: [{ parameter_id: parameter.id, value: 4.2, time: standing, replicate_index: 0 }],
	});
	await post('/collection_events/stage', { site_id: site.id, collected_at: standing });
	return { siteId: site.id, code, standing };
}

/** Paste a block into whatever the grid has selected, as the clipboard delivers it. */
async function paste(page: import('@playwright/test').Page, block: string) {
	await page.evaluate((text) => {
		const data = new DataTransfer();
		data.setData('text/plain', text);
		(document.activeElement ?? document).dispatchEvent(
			new ClipboardEvent('paste', { clipboardData: data, bubbles: true }),
		);
	}, block);
}

/** A day at midnight UTC, the shape a lab's date column carries. */
function day(offset: number): string {
	return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

test('a block pasted under the last visit stages its own dates and saves in one go', async ({
	page,
	request,
}) => {
	const { siteId, code } = await seedSite(request);
	const [first, second, third] = [day(-3), day(-2), day(-1)];

	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('1 visit', { exact: true })).toBeVisible();

	// The spare row stands under the one listed visit, and the block runs three rows past it.
	await frozenCell(page, 1).click();
	await paste(page, `${first}\t5.1\n${second}\t5.2\n${third}\t5.3`);

	const save = page.getByRole('button', { name: /^Save / });
	await expect(save).toContainText('Save 3 values and 3 new visits');
	await expect(page.locator('.ht_clone_inline_start').getByText('new visit')).toHaveCount(3);

	await page.getByRole('button', { name: 'Check against site history' }).click();
	await expect(save).toBeEnabled();
	await save.click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText('3 new visits will be opened at this site');
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(dialog).toBeHidden();

	// The three visits stand on the site with their values on them, beside the one that was there.
	// The empty spare row keeps its own cell, which names no date yet.
	await expect(page.getByText('4 visits', { exact: true })).toBeVisible();
	const cells = sheetCell(page, new RegExp(`^${code} at`));
	await expect(cells).toHaveCount(4);
	await expect(cells.nth(0)).toHaveText('5.3');
	await expect(cells.nth(2)).toHaveText('5.1');
	await expect(cells.nth(3)).toHaveText('4.2');
});

test('a spare row naming a date the site already holds is refused rather than joined', async ({
	page,
	request,
}) => {
	const { siteId, standing } = await seedSite(request);

	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('1 visit', { exact: true })).toBeVisible();

	await typeInto(page, frozenCell(page, 1), standing);
	await expect(page.getByText(`a visit already stands at ${standing}`).first()).toBeVisible();
	await expect(page.getByRole('button', { name: /^Save/ })).toBeDisabled();
});

test('a spare row at a visit the listing does not show is refused and marked', async ({
	page,
	request,
}) => {
	const { siteId } = await seedSite(request);
	const headers = { Authorization: `Bearer ${await token(request)}` };
	// A visit a year before the one seeded, so a range filter can page it off the screen.
	const offScreen = new Date(Date.now() - 400 * 86_400_000).toISOString().replace(/\.\d+Z$/, 'Z');
	const staged = await request.post(`${API_URL}/api/collection_events/stage`, {
		headers,
		data: { site_id: siteId, collected_at: offScreen },
	});
	expect(staged.ok(), `stage -> ${staged.status()}`).toBeTruthy();

	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	// Filter the grid to the recent visit alone, so the older one is nowhere in the rows.
	await page.getByLabel('From').fill(`${day(-60)}T00:00`);
	await expect(page.getByText('1 visit in range', { exact: true })).toBeVisible();

	await typeInto(page, frozenCell(page, 1), offScreen);
	await expect(page.getByText(`a visit already stands at ${offScreen}`).first()).toBeVisible();
	await expect(page.locator('.ht_clone_inline_start td.sheet-refused')).toHaveCount(1);
	await expect(page.getByRole('button', { name: /^Save/ })).toBeDisabled();
});

test('a row added by hand opens a visit at the date typed into it', async ({ page, request }) => {
	const { siteId } = await seedSite(request);
	const when = day(-5);

	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('1 visit', { exact: true })).toBeVisible();

	// The plus sits in the grid's corner, so it stays under the pointer however many rows it adds.
	const more = page.getByRole('button', { name: 'One new row more' });
	const before = await more.boundingBox();
	await more.click();
	await more.click();
	// The corner is redrawn on each add, so the box is read once the new plus is in place.
	await expect.poll(() => more.boundingBox()).toEqual(before);
	await typeInto(page, frozenCell(page, 2), when);

	const save = page.getByRole('button', { name: /^Save / });
	await expect(save).toContainText('Save 0 values and 1 new visit');
	await save.click();
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByText('2 visits', { exact: true })).toBeVisible();

	// The visit it opened takes notes in its panel, as one made from the New visit dialog does.
	await frozenButton(page, { name: frozenDate(new Date(`${when}T00:00:00`)) }).click();
	const notes = page.getByLabel('Notes', { exact: true });
	await notes.fill('Snow on the bank');
	await notes.blur();
	await expect(page.getByText('Notes saved')).toBeVisible();

	// The open visit is in the URL, so the reload opens it again.
	await page.reload();
	await expect(page.getByLabel('Notes', { exact: true })).toHaveValue('Snow on the bank');
});

test.describe('a browser in Tokyo', () => {
	test.use({ timezoneId: 'Asia/Tokyo' });

	test('a bare date pasted under the table is read in the zone the page selector names', async ({
		page,
		request,
	}) => {
		const { siteId } = await seedSite(request);
		const when = day(-3);
		// Tokyo keeps UTC+9 all year, so a day there starts at 15:00 the evening before.
		const eveningBefore = new Date(`${when}T00:00:00Z`);
		eveningBefore.setUTCDate(eveningBefore.getUTCDate() - 1);
		const inTokyo = `${eveningBefore.toISOString().slice(0, 10)} 15:00:00Z`;

		await signIn(page);
		await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
		await expect(page.getByText('1 visit', { exact: true })).toBeVisible();
		await expect(page.getByLabel('Zone new rows are dated in')).toHaveCount(0);
		const header = page.locator('.ht_master .colHeader').filter({ hasText: /^Date / });
		await expect(header).toHaveText('Date (Asia/Tokyo)');

		await frozenCell(page, 1).click();
		await paste(page, `${when}\t5.1`);

		const staged = page.locator('.ht_clone_inline_start').getByText('new visit at');
		await expect(staged).toHaveText(`new visit at ${inTokyo}`);

		// The same cell, read in UTC, opens the visit at the start of the day it names.
		await page.getByRole('button', { name: 'Local', exact: true }).click();
		await expect(header).toHaveText('Date (UTC)');
		await expect(staged).toHaveText(`new visit at ${when} 00:00:00Z`);
	});
});
