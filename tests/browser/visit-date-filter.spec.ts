import { expect, test, type APIRequestContext } from '@playwright/test';
import { API_URL, BASE_PATH, postGrab, signIn, token } from './portal';

// Scenario: a station visited over several years. Expected behaviour: the Visits tab carries a
// bar spanning the period the site holds visits, and dragging it narrows the listing the way the
// typed dates do.

let seeded = 0;

/** A site holding one spot parameter measured on three visits, years apart. */
async function seedVisits(request: APIRequestContext): Promise<{ siteId: string }> {
	const stamp = `${Date.now()}_${(seeded += 1)}`;
	const headers = { Authorization: `Bearer ${await token(request)}` };
	const post = async (path: string, data: unknown) => {
		const response = await request.post(`${API_URL}/api${path}`, { headers, data });
		expect(response.ok(), `${path} -> ${response.status()} ${await response.text()}`).toBeTruthy();
		return response.json();
	};

	const project = await post('/projects', { name: `Visit range ${stamp}` });
	const site = await post('/sites', { name: `Visit range ${stamp}`, project_id: project.id });
	const parameter = await post('/parameters', {
		code: `visit_range_${stamp}`,
		name: 'Visit range parameter',
		category: 'measurement',
		aliases: [],
	});
	await post('/site_parameters', {
		site_id: site.id,
		parameter_id: parameter.id,
		name: 'Visit range parameter',
	});
	for (const [index, time] of ['2019-05-02T06:30:00Z', '2022-06-14T07:00:00Z', '2025-07-21T08:00:00Z'].entries()) {
		await postGrab(post, {
			site_id: site.id,
			mode: 'replace',
			readings: [{ parameter_id: parameter.id, value: 10 + index, time, replicate_index: 0 }],
		});
	}
	return { siteId: site.id };
}

test('dragging the visits bar narrows the listing, and All dates puts it back', async ({
	page,
	request,
}) => {
	const { siteId } = await seedVisits(request);

	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('3 visits', { exact: true })).toBeVisible();

	// The bar spans the site's own visits, so its left end is the 2019 one.
	const bar = page.locator('.noUi-target').first();
	await expect(bar).toBeVisible();
	const handle = page.locator('.noUi-handle-lower').first();
	const box = await handle.boundingBox();
	const track = await bar.boundingBox();
	expect(box && track).toBeTruthy();

	await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
	await page.mouse.down();
	await page.mouse.move(track!.x + track!.width, box!.y + box!.height / 2, { steps: 10 });
	await page.mouse.up();

	// The listing follows the bar, and the typed field carries the instant it was dragged to.
	await expect(page.getByText(/1 visit in range/)).toBeVisible();
	await expect(page.getByRole('button', { name: 'All dates' })).toBeVisible();

	await page.getByRole('button', { name: 'All dates' }).click();
	await expect(page.getByText('3 visits', { exact: true })).toBeVisible();
});
