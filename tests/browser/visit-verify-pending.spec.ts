import { expect, test, type APIRequestContext } from '@playwright/test';
import { API_URL, BASE_PATH, KEYCLOAK_URL, signIn, token } from './portal';

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

async function seedPendingVisit(
	request: APIRequestContext,
): Promise<{ siteName: string; siteId: string; visitId: string }> {
	const stamp = `${Date.now()}`;
	const admin = { Authorization: `Bearer ${await token(request)}` };
	const call = async (method: 'post' | 'put', path: string, data: unknown, headers = admin) => {
		const response = await request[method](`${API_URL}/api${path}`, { headers, data });
		expect(response.ok(), `${path} -> ${response.status()} ${await response.text()}`).toBeTruthy();
		return response.json();
	};
	const siteName = `Pending field day ${stamp}`;
	const project = await call('post', '/projects', { name: siteName });
	const site = await call('post', '/sites', { name: siteName, project_id: project.id });

	const intern = await tokenFor(request, 'intern1');
	const grantsPath = `/users/${subject(intern)}/grants`;
	const held = await request.get(`${API_URL}/api${grantsPath}`, { headers: admin });
	expect(held.ok(), `${grantsPath} -> ${held.status()}`).toBeTruthy();
	const projectIds = ((await held.json()) as Array<{ project_id?: string } | string>).map((g) =>
		typeof g === 'string' ? g : (g.project_id ?? ''),
	);
	await call('put', grantsPath, { project_ids: [...projectIds.filter(Boolean), project.id] });

	const visit = await call(
		'post',
		'/collection_events/stage',
		{ site_id: site.id, collected_at: '2024-03-07T10:00:00Z' },
		{ Authorization: `Bearer ${intern}` },
	);
	expect(visit.unverified, 'an intern opens the field day pending').toBe(true);
	return { siteName, siteId: site.id, visitId: visit.id };
}

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
	const [visit] = (await visits.json()).items as Array<{ id: string; unverified: boolean }>;
	expect(visit.id).toBe(visitId);
	expect(visit.unverified, 'the field day is no longer pending').toBe(false);
});
