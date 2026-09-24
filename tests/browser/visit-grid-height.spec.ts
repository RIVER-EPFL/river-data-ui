import { expect, test, type APIRequestContext } from '@playwright/test';
import { API_URL, BASE_PATH, postGrab, signIn, token } from './portal';

// Scenario: a site with more parameters than fit across the screen, the last of them with a long
// code and units and a triplicate at each visit. Expected behaviour: scrolling the Visits table
// sideways changes no row's height, so nothing under the table moves.

const COLUMNS = 30;

async function seedWideSite(request: APIRequestContext): Promise<string> {
	const stamp = `${Date.now()}`;
	const headers = { Authorization: `Bearer ${await token(request)}` };
	const post = async (path: string, data: unknown) => {
		const response = await request.post(`${API_URL}/api${path}`, { headers, data });
		expect(response.ok(), `${path} -> ${response.status()} ${await response.text()}`).toBeTruthy();
		return response.json();
	};

	const project = await post('/projects', { name: `Wide ${stamp}` });
	const site = await post('/sites', { name: `Wide ${stamp}`, project_id: project.id });
	const parameters = [];
	for (let i = 0; i < COLUMNS; i += 1) {
		const last = i === COLUMNS - 1;
		const parameter = await post('/parameters', {
			code: last ? `wide_dissolved_organic_carbon_${stamp}` : `w${i}_${stamp}`,
			name: `Wide ${i}`,
			category: 'measurement',
			aliases: [],
			...(last ? { default_units: 'mg C L-1 filtered at 0.45 um' } : {}),
		});
		await post('/site_parameters', { site_id: site.id, parameter_id: parameter.id, name: parameter.name });
		parameters.push(parameter);
	}
	const far = parameters[COLUMNS - 1];
	for (let day = 1; day <= 3; day += 1) {
		const time = new Date(Date.now() - day * 86_400_000).toISOString().replace(/\.\d+Z$/, 'Z');
		await postGrab(post, {
			site_id: site.id,
			mode: 'replace',
			readings: [
				{ parameter_id: parameters[0].id, value: 1, time, replicate_index: 0 },
				{ parameter_id: far.id, value: 10, time, replicate_index: 0 },
				{ parameter_id: far.id, value: 12, time, replicate_index: 1 },
				{ parameter_id: far.id, value: 14, time, replicate_index: 2 },
			],
		});
		await post('/collection_events/stage', { site_id: site.id, collected_at: time });
	}
	return site.id;
}

test('scrolling the Visits table sideways keeps every row and header at its height', async ({
	page,
	request,
}) => {
	const siteId = await seedWideSite(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('3 visits', { exact: true })).toBeVisible();

	const holder = page.locator('.ht_master .wtHolder');
	const grid = page.locator('.sheet-grid');
	const firstRow = page.locator('.ht_clone_inline_start tbody tr').first();
	const measure = async () => ({
		grid: (await grid.boundingBox())?.height,
		row: (await firstRow.boundingBox())?.y,
	});
	const start = await measure();

	await holder.evaluate((el) => (el.scrollLeft = el.scrollWidth));
	await page.waitForTimeout(300);
	expect(await measure()).toEqual(start);

	await holder.evaluate((el) => (el.scrollLeft = 0));
	await page.waitForTimeout(300);
	expect(await measure()).toEqual(start);
});
