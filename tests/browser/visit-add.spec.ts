import { expect, test, type APIRequestContext } from '@playwright/test';
import { API_URL, BASE_PATH, signIn, token } from './portal';
import { frozenButton, sheetCell } from './sheet';

// Scenario: a field day is typed from the Visits table itself, not staged elsewhere first. Adding
// is the table's own control: rows of a site and a time, saved together.

let seeded = 0;

/** A site holding one spot parameter and no visits at all. */
async function seedSite(
	request: APIRequestContext,
): Promise<{ siteId: string; siteName: string; parameterCode: string }> {
	const stamp = `${Date.now()}_${(seeded += 1)}`;
	const headers = { Authorization: `Bearer ${await token(request)}` };
	const post = async (path: string, data: unknown) => {
		const response = await request.post(`${API_URL}/api${path}`, { headers, data });
		expect(response.ok(), `${path} -> ${response.status()} ${await response.text()}`).toBeTruthy();
		return response.json();
	};

	const project = await post('/projects', { name: `New visit ${stamp}` });
	const name = `New visit ${stamp}`;
	const site = await post('/sites', { name, project_id: project.id });
	const parameterCode = `new_visit_${stamp}`;
	const parameter = await post('/parameters', {
		code: parameterCode,
		name: 'New visit parameter',
		category: 'measurement',
		aliases: [],
	});
	await post('/site_parameters', {
		site_id: site.id,
		parameter_id: parameter.id,
		name: 'New visit parameter',
	});
	return { siteId: site.id, siteName: name, parameterCode };
}

/** Today at the given hour, in the browser's own zone, as a datetime-local input takes it. */
function todayAt(hour: number): string {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:00`;
}

test('two visits of one field day are added in one save and both stand on the site', async ({
	page,
	request,
}) => {
	const { siteId, siteName, parameterCode } = await seedSite(request);
	const morning = todayAt(8);
	const afternoon = todayAt(14);

	await signIn(page);
	await page.goto(`${BASE_PATH}/events`);
	await page.getByRole('button', { name: 'New visit' }).click();

	const dialog = page.getByRole('dialog');
	await dialog.locator('#nv-site-0').selectOption(siteId);
	await dialog.getByLabel('Date and time, row 1').fill(morning);
	await dialog.getByRole('button', { name: 'Add another' }).click();
	await dialog.locator('#nv-site-1').selectOption(siteId);

	// The new row keeps the first row's time, so it repeats it until the time is changed.
	await expect(dialog.getByText('Same site and time as row 1')).toBeVisible();
	await expect(dialog.getByRole('button', { name: 'Add 2 visits' })).toBeDisabled();
	await dialog.getByLabel('Date and time, row 2').fill(afternoon);
	await dialog.getByRole('button', { name: 'Add 2 visits' }).click();
	const added = dialog.getByRole('link', { name: 'Open the visit' });
	await expect(added).toHaveCount(2);

	// The second one opens the site's table at that visit: the site's one slot is a column, and
	// nothing is entered under it at either visit.
	await added.nth(1).click();
	await expect(page).toHaveURL(new RegExp(`/sites/${siteId}\\?tab=visits&event=[0-9a-f-]{36}`));
	const cells = sheetCell(page, new RegExp(`^${parameterCode} at`));
	await expect(cells).toHaveCount(2);
	await expect(cells.first()).toHaveText('');

	// Both are on the site's Visits tab, which is the same table filtered to the site.
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('2 visits')).toBeVisible();
	// The hour is rendered in the browser's own locale, so match the clock rather than the format.
	await expect(frozenButton(page, { name: /\b0?8:00/ })).toBeVisible();
	await expect(frozenButton(page, { name: /\b(14|0?2):00/ })).toBeVisible();
	await expect(page.getByText(siteName).first()).toBeVisible();
});
