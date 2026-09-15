import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { BASE_PATH, signIn } from './portal';

// Scenario: a section opened inside a page that has room to spare. Expected behaviour: nothing on
// it scrolls sideways. A horizontal scrollbar is for a table wider than the viewport, never for
// one merely wider than the box it was put in.

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

/** A site with twenty spot parameters and one visit holding two replicates of each. */
async function seedVisit(request: APIRequestContext): Promise<{ siteId: string }> {
	const stamp = `${Date.now()}_${(seeded += 1)}`;
	const headers = { Authorization: `Bearer ${await token(request)}` };
	const post = async (path: string, data: unknown) => {
		const response = await request.post(`${API_URL}/api${path}`, { headers, data });
		expect(response.ok(), `${path} -> ${response.status()} ${await response.text()}`).toBeTruthy();
		return response.json();
	};

	const project = await post('/projects', { name: `Scroll ${stamp}` });
	const site = await post('/sites', { name: `Scroll ${stamp}`, project_id: project.id });
	const collectedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
	const readings = [];
	for (let i = 0; i < 20; i += 1) {
		const parameter = await post('/parameters', {
			code: `scroll_${stamp}_${i}`,
			name: `Scroll parameter ${i}`,
			category: 'measurement',
			aliases: [],
		});
		await post('/site_parameters', {
			site_id: site.id,
			parameter_id: parameter.id,
			name: `Scroll parameter ${i}`,
		});
		readings.push(
			{ parameter_id: parameter.id, value: 10 + i, time: collectedAt, replicate_index: 0 },
			{ parameter_id: parameter.id, value: 12 + i, time: collectedAt, replicate_index: 1 },
		);
	}
	await post('/grab_samples', { site_id: site.id, mode: 'replace', readings });
	await post('/collection_events/stage', { site_id: site.id, collected_at: collectedAt });
	return { siteId: site.id };
}

/** Every element scrolling sideways, named by what a reader would recognise it as. */
async function sideScrollers(page: Page): Promise<string[]> {
	return page.evaluate(() =>
		Array.from(document.querySelectorAll<HTMLElement>('*'))
			.filter((el) => {
				if (el.scrollWidth - el.clientWidth <= 1) return false;
				const overflow = getComputedStyle(el).overflowX;
				return overflow === 'auto' || overflow === 'scroll';
			})
			.map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 120)),
	);
}

test('nothing on an expanded visit scrolls sideways in a window with room', async ({
	page,
	request,
}) => {
	const { siteId } = await seedVisit(request);
	await page.setViewportSize({ width: 1400, height: 900 });
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);

	await expect(page.getByText('1 visit')).toBeVisible();
	// A site of twenty parameters is genuinely wider than the window, so its own wrapper scrolls.
	// Nothing else may.
	const wrapper = page.locator('div.overflow-x-auto').filter({ has: page.locator('table') }).first();
	expect(await sideScrollers(page)).toHaveLength(1);

	await page.locator('button[title="Expand this visit"]').click();
	await expect(page.getByText('Scroll parameter 0')).toBeVisible();
	expect(await sideScrollers(page), 'the expanded visit adds no scroller').toHaveLength(1);

	// The panel takes the width its content needs, not the table's, and stays at the window's left
	// edge however far the table is scrolled.
	const panel = page.locator('td[colspan] > div').first();
	const box = async () => (await panel.boundingBox())!;
	const room = await wrapper.evaluate((el) => el.clientWidth);
	expect((await box()).width).toBeLessThanOrEqual(room);

	const edge = (await wrapper.boundingBox())!.x;
	await wrapper.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
	await expect
		.poll(async () => Math.round((await box()).x - edge), {
			message: 'the panel is still at the left edge after the table is scrolled right',
		})
		.toBeLessThanOrEqual(16);
});
