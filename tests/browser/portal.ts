import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const BASE_PATH = '/admin';

/** The seeded realm's login form, reached from the landing page's sign-in button. */
export const LOGIN_URL = /\/realms\/river-data\/protocol\/openid-connect\/auth/;

/** A site the dev stack seeds with continuous readings up to the current day. */
export const SEEDED_SITE = 'Martigny';

export async function signIn(page: Page, username = 'admin', password = 'admin') {
	await page.goto(`${BASE_PATH}/`);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(LOGIN_URL);
	await page.locator('#username').fill(username);
	await page.locator('#password').fill(password);
	await page.locator('#kc-login').click();
	await expect(page.getByRole('heading', { name: 'RIVER Data: Admin' })).toBeVisible();
}

export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3006';
export const KEYCLOAK_URL = process.env.E2E_KEYCLOAK_URL ?? 'http://localhost:8180/';

/** An access token for the seeded realm's admin, which the seeds write through. */
export async function token(request: APIRequestContext): Promise<string> {
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

/** The formula a calculation publishes, as the set save wrote it. */
export interface SavedFormula {
	id: string;
	code: string;
	output_parameter_id: string;
}

/**
 * Save a formula calculation's set and read back the formula row it wrote.
 *
 * One save is one version (Q186), and the chain reads a calculation only through its pinned
 * version, so a seed that writes the formula through `/derived_parameters` leaves a calculation
 * nothing runs.
 */
export async function saveFormulaSet(
	request: APIRequestContext,
	headers: Record<string, string>,
	scriptId: string,
	formula: Record<string, unknown>,
): Promise<SavedFormula> {
	const saved = await request.post(`${API_URL}/api/tool_scripts/${scriptId}/formulas`, {
		headers,
		data: { formulas: [formula] },
	});
	expect(saved.ok(), `formulas -> ${saved.status()} ${await saved.text()}`).toBeTruthy();
	const filter = encodeURIComponent(JSON.stringify({ tool_script_id: scriptId }));
	const listed = await request.get(`${API_URL}/api/derived_parameters?filter=${filter}`, {
		headers,
	});
	expect(listed.ok(), `derived_parameters -> ${listed.status()}`).toBeTruthy();
	const [written] = (await listed.json()) as SavedFormula[];
	expect(written, 'the save wrote the calculation its formula').toBeTruthy();
	return written;
}

type GrabReading = { parameter_id: string; value: number; time: string } & Record<string, unknown>;

/**
 * Save grab values the way every client must (Q262): screen them with a seasonal check first and
 * name it on the save.
 */
export async function postGrab(
	post: (path: string, data: unknown) => Promise<unknown>,
	body: { site_id: string; readings: GrabReading[] } & Record<string, unknown>,
) {
	const check = (await post('/readings/seasonal_check', {
		site_id: body.site_id,
		time: body.readings[0].time,
		values: body.readings.map((r) => ({ parameter_id: r.parameter_id, value: r.value })),
	})) as { check_id: string };
	return post('/grab_samples', { ...body, check_id: check.check_id });
}
