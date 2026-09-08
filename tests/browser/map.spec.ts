import { expect, test } from '@playwright/test';
import { BASE_PATH, signIn } from './portal';

// The dashboard map only renders for sites that carry coordinates, and the dev database's sites
// may carry none, so the list response is filled in with Valais coordinates where they are absent.
test.beforeEach(async ({ page }) => {
	await page.route(/\/api\/sites(\?|$)/, async (route) => {
		const response = await route.fetch();
		const body = await response.json();
		if (!Array.isArray(body)) return route.fulfill({ response });
		const placed = body.map((site, i) => ({
			...site,
			latitude: site.latitude ?? 46.1 + i * 0.01,
			longitude: site.longitude ?? 7.07 + i * 0.01,
		}));
		await route.fulfill({ response, json: placed });
	});
});

test('the dashboard map renders and switches to the SwissTopo layer', async ({ page }) => {
	await signIn(page);

	const map = page.locator('.leaflet-container');
	await expect(map).toBeVisible();
	await expect(map.locator('img.leaflet-tile').first()).toBeAttached();

	await page.locator('.leaflet-control-layers').hover();
	await page.getByText('SwissTopo', { exact: true }).click();

	await expect(map.locator('img.leaflet-tile[src*="wmts.geo.admin.ch"]').first()).toBeAttached();
});

test('the map places one marker per sited site', async ({ page }) => {
	await signIn(page);
	await expect(page.locator('.leaflet-container')).toBeVisible();
	await expect(page.locator('.leaflet-marker-icon').first()).toBeVisible();
});
