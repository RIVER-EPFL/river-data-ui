import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { BASE_PATH, signIn } from './portal';

// The entry grid is the surface the lab works in all day, and the behaviours that matter are the
// composed ones: what a cell accepts, what a save says it will do, and what comes back. The pure
// halves are covered by `src/lib/visits/*.test.ts`; this is the page wiring them, one story rather
// than one test per assertion.
//
// The visit is built through the API rather than taken from the seed, so the story does not depend
// on which sync services have run against the dev database.

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3005';
const KEYCLOAK_URL = process.env.E2E_KEYCLOAK_URL ?? 'http://localhost:8180/';

/** Each story builds its own site, parameter and visit, so the two do not collide. */
let seeded = 0;

interface Fixture {
	siteId: string;
	eventId: string;
	collectedAt: string;
}

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

/** A site with one spot parameter and one visit holding two replicates of it. */
async function seedVisit(request: APIRequestContext, empty = false): Promise<Fixture> {
	const stamp = `${Date.now()}_${(seeded += 1)}`;
	const bearer = await token(request);
	const headers = { Authorization: `Bearer ${bearer}` };
	const post = async (path: string, data: unknown) => {
		const response = await request.post(`${API_URL}/api${path}`, { headers, data });
		expect(response.ok(), `${path} -> ${response.status()} ${await response.text()}`).toBeTruthy();
		return response.json();
	};

	const project = await post('/projects', { name: `Entry grid ${stamp}` });
	const site = await post('/sites', { name: `Entry grid ${stamp}`, project_id: project.id });
	const parameter = await post('/parameters', {
		code: `entry_grid_${stamp}`,
		name: 'Entry grid parameter',
		category: 'measurement',
		aliases: [],
	});
	await post('/site_parameters', {
		site_id: site.id,
		parameter_id: parameter.id,
		name: 'Entry grid parameter',
	});

	const collectedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
	if (!empty) await post('/grab_samples', {
		site_id: site.id,
		mode: 'replace',
		readings: [
			{ parameter_id: parameter.id, value: 10, time: collectedAt, replicate_index: 0 },
			{ parameter_id: parameter.id, value: 12, time: collectedAt, replicate_index: 1 },
		],
	});
	const staged = await post('/collection_events/stage', {
		site_id: site.id,
		collected_at: collectedAt,
	});
	return { siteId: site.id, eventId: staged.id, collectedAt };
}

function cell(page: Page, row: number, column: number) {
	return page.getByTestId(`grid-cell-${row}-${column}`);
}

test('an empty visit can be discarded from its grid', async ({ page, request }) => {
	const visit = await seedVisit(request, true);
	await signIn(page);
	await page.goto(`${BASE_PATH}/visits/${visit.eventId}`);
	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: 'Discard this visit' }).click();
	await expect(page).toHaveURL(new RegExp(`/sites/${visit.siteId}\\?tab=visits$`));
	const response = await request.get(`${API_URL}/api/collection_events/${visit.eventId}/detail`, {
		headers: { Authorization: `Bearer ${await token(request)}` },
	});
	expect(response.status()).toBe(404);
});

test('a visit is entered, its consequence read, and its saved value comes back', async ({
	page,
	request,
}) => {
	const visit = await seedVisit(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/visits/${visit.eventId}`);

	// The visit opens on what it holds: one row, two replicates, and the statistics beside them.
	const row = page.getByRole('row').filter({ hasText: 'Entry grid parameter' });
	await expect(row).toHaveCount(1);
	await expect(cell(page, 0, 0)).toHaveValue('10');
	await expect(cell(page, 0, 1)).toHaveValue('12');
	await expect(row).toContainText('11');

	// Nothing has moved, so there is nothing to save.
	const save = page.getByRole('button', { name: /^Save .*value/ });
	await expect(save).toBeDisabled();

	// A row is as wide as the repeats it holds, so the cell after the last one is where a third
	// replicate is entered. It is an entry, not a correction, and the save counts only what moved.
	await cell(page, 0, 2).fill('14');
	await expect(save).toContainText('Save 1 value');

	// The consequence and the screening are on the bar, beside the values: a save may go past a
	// warning, but not past an unchecked value, so Save stays shut until the check has run.
	await expect(save).toBeDisabled();
	await page.getByRole('button', { name: 'Check against site history' }).click();
	await expect(page.getByText('Entry grid parameter:')).toBeVisible();
	await expect(save).toBeEnabled();

	// What is left in the dialog is the count and the corrected/entered split, and nothing else.
	await save.click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText('1 value will be written');
	await expect(dialog).toContainText('0 corrected in place');
	await expect(dialog.getByRole('button', { name: /^Check/ })).toHaveCount(0);
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();

	// The value comes back from the store, and the trigger's mean moves with it.
	await expect(dialog).toBeHidden();
	await expect(save).toBeDisabled();
	await expect(cell(page, 0, 2)).toHaveValue('14');
	await expect(row).toContainText('12');
});

test('a pasted block fills rightward and a blank cell stays a gap', async ({ page, request }) => {
	const visit = await seedVisit(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/visits/${visit.eventId}`);

	await expect(cell(page, 0, 0)).toHaveValue('10');
	await cell(page, 0, 0).focus();
	await page.evaluate(() => {
		const input = document.querySelector<HTMLInputElement>('[data-testid="grid-cell-0-0"]')!;
		const data = new DataTransfer();
		data.setData('text/plain', '21\t\t23');
		input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
	});

	// The block grew the grid to its own width, the blank did not shift the value after it, and the
	// stored replicate under the blank is untouched rather than cleared to nothing.
	await expect(cell(page, 0, 0)).toHaveValue('21');
	await expect(cell(page, 0, 1)).toHaveValue('');
	await expect(cell(page, 0, 2)).toHaveValue('23');
	await expect(page.getByRole('button', { name: /^Save .*value/ })).toContainText('Save 2 values');
});

test('a typed value is not lost to a link out of the grid', async ({ page, request }) => {
	const visit = await seedVisit(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/visits/${visit.eventId}`);

	await cell(page, 0, 2).fill('14');
	await expect(page.getByRole('button', { name: /^Save .*value/ })).toBeEnabled();

	// Declining the prompt keeps the operator on the visit, with what they typed.
	const back = page.getByRole('link', { name: 'Back to the site' });
	const declined = page.waitForEvent('dialog');
	await back.click();
	await (await declined).dismiss();
	await expect(page).toHaveURL(new RegExp(`/visits/${visit.eventId}$`));
	await expect(cell(page, 0, 2)).toHaveValue('14');

	// Accepting it leaves.
	const accepted = page.waitForEvent('dialog');
	await back.click();
	await (await accepted).accept();
	await expect(page).toHaveURL(new RegExp(`/sites/${visit.siteId}\\?tab=visits`));
});
