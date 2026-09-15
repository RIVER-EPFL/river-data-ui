import { expect, test, type APIRequestContext } from '@playwright/test';
import { BASE_PATH, signIn } from './portal';

// Scenario: a field day is typed from the Visits table itself, not staged elsewhere first. Adding
// is the table's own control, a site and a date, and it takes several in a row.

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

/** A site holding one spot parameter and no visits at all. */
async function seedSite(request: APIRequestContext): Promise<{ siteId: string; siteName: string }> {
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
	const parameter = await post('/parameters', {
		code: `new_visit_${stamp}`,
		name: 'New visit parameter',
		category: 'measurement',
		aliases: [],
	});
	await post('/site_parameters', {
		site_id: site.id,
		parameter_id: parameter.id,
		name: 'New visit parameter',
	});
	return { siteId: site.id, siteName: name };
}

/** Today at the given hour, in the browser's own zone, as a datetime-local input takes it. */
function todayAt(hour: number): string {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:00`;
}

test('two visits are added from the Visits list and both stand on the site', async ({
	page,
	request,
}) => {
	const { siteId, siteName } = await seedSite(request);
	const morning = todayAt(8);
	const afternoon = todayAt(14);

	await signIn(page);
	await page.goto(`${BASE_PATH}/events`);
	await page.getByRole('button', { name: 'New visit' }).click();

	const dialog = page.getByRole('dialog');
	await dialog.locator('#nv-site').selectOption(siteId);
	await dialog.locator('#nv-time').fill(morning);
	await dialog.getByRole('button', { name: 'Add visit' }).click();
	await expect(dialog.getByRole('link', { name: 'Open the grid' })).toHaveCount(1);

	// The dialog stays open for the next station of the same day.
	await dialog.locator('#nv-time').fill(afternoon);
	await dialog.getByRole('button', { name: 'Add visit' }).click();
	const added = dialog.getByRole('link', { name: 'Open the grid' });
	await expect(added).toHaveCount(2);

	// The second one opens on the site's slots, with nothing entered.
	await added.nth(1).click();
	await expect(page).toHaveURL(/\/visits\/[0-9a-f-]{36}$/);
	await expect(page.getByRole('row').filter({ hasText: 'New visit parameter' })).toHaveCount(1);

	// Both are on the site's Visits tab, which is the same table filtered to the site.
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('2 visits')).toBeVisible();
	// The hour is rendered in the browser's own locale, so match the clock rather than the format.
	await expect(page.getByRole('button', { name: /\b0?8:00/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /\b(14|0?2):00/ })).toBeVisible();
	await expect(page.getByText(siteName).first()).toBeVisible();
});
