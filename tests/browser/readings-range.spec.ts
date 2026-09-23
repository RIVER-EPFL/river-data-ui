import { expect, test, type Request } from '@playwright/test';
import { API_URL, BASE_PATH, SEEDED_SITE, signIn, token } from './portal';

// Scenario: someone narrows the Readings list to a stretch of time.
// Expected behaviour: the list carries the charts' scrub bar over the chosen site's data, and a
// drag of its lower handle, or a preset, reloads the list over the window it now shows.

/** The time window a readings list request asks for, or null for any other request. */
function askedWindow(request: Request): { from: number; to: number } | null {
	const url = new URL(request.url());
	if (!url.pathname.endsWith('/api/readings')) return null;
	const filter = JSON.parse(url.searchParams.get('filter') ?? '{}');
	if (!filter.time_gte || !filter.time_lte) return null;
	return { from: Date.parse(filter.time_gte), to: Date.parse(filter.time_lte) };
}

test('dragging the Readings scrub bar reloads the list over the dragged window', async ({
	page,
	request,
}) => {
	const headers = { Authorization: `Bearer ${await token(request)}` };
	const filter = encodeURIComponent(JSON.stringify({ name: SEEDED_SITE }));
	const [site] = await (await request.get(`${API_URL}/api/sites?filter=${filter}`, { headers })).json();

	await signIn(page);
	await page.goto(`${BASE_PATH}/readings?site=${site.id}`);
	const lower = page.locator('.noUi-handle-lower');
	await expect(lower).toBeVisible();

	const box = await lower.boundingBox();
	if (!box) throw new Error('the lower handle has no box');
	const dragged = page.waitForRequest((r) => askedWindow(r) !== null);
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 8 });
	await page.mouse.up();
	const afterDrag = askedWindow(await dragged)!;
	// The list opened on the last seven days; the dragged handle starts it later than that.
	expect(afterDrag.from).toBeGreaterThan(Date.now() - 7 * 86_400_000 + 3_600_000);
	expect(afterDrag.to).toBeGreaterThan(afterDrag.from);
	await expect(page.getByRole('row').nth(1)).toBeVisible();

	const preset = page.waitForRequest((r) => askedWindow(r) !== null);
	await page.getByRole('button', { name: '24h' }).click();
	const day = askedWindow(await preset)!;
	expect(day.to - day.from).toBe(86_400_000);
	await expect(page.getByRole('button', { name: '24h' })).toHaveAttribute('aria-pressed', 'true');
});
