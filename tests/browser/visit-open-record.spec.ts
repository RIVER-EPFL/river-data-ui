import { expect, test, type APIRequestContext } from '@playwright/test';
import { API_URL, BASE_PATH, signIn, token } from './portal';
import { frozenButton, frozenDate } from './sheet';

// Scenario: a site with a long list of visits, one of them open, and the reader scrolled down it.
//
// Expected behaviour: opening a visit's record leaves the table where the reader left it. Opening
// one closes whatever row was open above it, which is what used to carry the page upwards.

const VISITS = 30;

/** The instant of the `n`th seeded visit, counting from one. */
function visitAt(n: number): Date {
	return new Date(Date.UTC(2026, 0, n, 9));
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
		const collectedAt = visitAt(i + 1).toISOString().replace(/\.\d+Z$/, 'Z');
		await post('/grab_samples', {
			site_id: site.id,
			mode: 'replace',
			readings: [
				{ parameter_id: parameter.id, value: 10 + i, time: collectedAt, replicate_index: 0 },
			],
		});
		await post('/collection_events/stage', { site_id: site.id, collected_at: collectedAt });
	}
	return { siteId: site.id, code };
}

test('opening a record leaves the reader where they were', async ({ page, request }) => {
	const { siteId, code } = await seedVisits(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);

	// The newest visit is at the top of the table, open with a record of its own, and the reader
	// has scrolled past all of it. A value the account may overwrite is typed in place, so the
	// record is opened from the date rather than from the number.
	await frozenButton(page, { name: frozenDate(visitAt(VISITS)) }).click();
	await expect(page.getByText(/1 parameter/)).toBeVisible();
	await page.getByRole('button', { name: code, exact: true }).click();
	await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();
	await page.evaluate(() => {
		const main = document.querySelector('main')!;
		main.scrollTop = main.scrollHeight;
	});

	// The oldest visit, at the bottom of the same table.
	const oldest = frozenButton(page, { name: frozenDate(visitAt(1)) });
	await oldest.scrollIntoViewIfNeeded();
	expect(
		await page.evaluate(() => document.querySelector('main')!.scrollTop),
		'the table is longer than the viewport',
	).toBeGreaterThan(0);

	await oldest.click();

	// Opening this one replaces the record below the grid; the row the reader clicked stays where it
	// was.
	await expect(oldest).toBeInViewport();
	const parameter = page.getByRole('button', { name: code, exact: true });
	await parameter.scrollIntoViewIfNeeded();
	await parameter.click();
	await expect(page.getByRole('button', { name: 'Close' })).toBeInViewport();
});
