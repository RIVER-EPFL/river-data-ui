import { expect, test, type APIRequestContext } from '@playwright/test';
import { BASE_PATH, signIn } from './portal';

// Scenario: a site with a long list of visits, one of them open, and the reader scrolled down it.
//
// Expected behaviour: clicking a value opens its record without moving the table under the reader.
// Opening one closes whatever row was open above it, which is what used to carry the page upwards.

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3005';
const KEYCLOAK_URL = process.env.E2E_KEYCLOAK_URL ?? 'http://localhost:8180/';
const VISITS = 30;

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

/** A site holding `VISITS` one-parameter visits, so the table is longer than the viewport. */
async function seedVisits(request: APIRequestContext) {
	const stamp = `${Date.now()}`;
	const bearer = await token(request);
	const headers = { Authorization: `Bearer ${bearer}` };
	const post = async (path: string, data: unknown) => {
		const response = await request.post(`${API_URL}/api${path}`, { headers, data });
		expect(response.ok(), `${path} -> ${response.status()} ${await response.text()}`).toBeTruthy();
		return response.json();
	};
	const code = `b341_${stamp}`;
	const siteName = `Scroll ${stamp}`;
	const project = await post('/projects', { name: siteName });
	const site = await post('/sites', { name: siteName, project_id: project.id });
	const parameter = await post('/parameters', {
		code,
		name: code,
		category: 'measurement',
		aliases: [],
	});
	await post('/site_parameters', { site_id: site.id, parameter_id: parameter.id, name: code });
	for (let i = 0; i < VISITS; i += 1) {
		const collectedAt = new Date(Date.UTC(2026, 0, i + 1, 9)).toISOString().replace(/\.\d+Z$/, 'Z');
		await post('/grab_samples', {
			site_id: site.id,
			mode: 'replace',
			readings: [
				{ parameter_id: parameter.id, value: 10 + i, time: collectedAt, replicate_index: 0 },
			],
		});
		await post('/collection_events/stage', { site_id: site.id, collected_at: collectedAt });
	}
	return { siteId: site.id };
}

test('opening a record from a value leaves the reader where they were', async ({ page, request }) => {
	const { siteId } = await seedVisits(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);

	// The newest visit is at the top of the table, open with a record of its own, and the reader
	// has scrolled past all of it.
	await page.getByRole('button', { name: /Jan 30, 2026/ }).click();
	await expect(page.getByText(/1 parameter/)).toBeVisible();
	await page.getByRole('button', { name: '39', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();
	await page.evaluate(() => {
		const main = document.querySelector('main')!;
		main.scrollTop = main.scrollHeight;
	});

	// The oldest visit's value, at the bottom of the same table.
	const value = page.getByRole('button', { name: '10', exact: true });
	await value.scrollIntoViewIfNeeded();
	expect(
		await page.evaluate(() => document.querySelector('main')!.scrollTop),
		'the table is longer than the viewport',
	).toBeGreaterThan(0);

	await value.click();

	// The record opens under the value that was clicked, and both are on screen: closing the row
	// above used to carry the table upwards and leave the record below the fold.
	await expect(value).toBeInViewport();
	await expect(page.getByRole('button', { name: 'Close' })).toBeInViewport();
});
