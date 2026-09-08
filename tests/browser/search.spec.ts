import { expect, test } from '@playwright/test';
import { BASE_PATH, SEEDED_SITE, signIn } from './portal';

test('Ctrl+K focuses the global search from anywhere in the shell', async ({ page }) => {
	await signIn(page);
	await page.keyboard.press('Control+k');
	await expect(page.locator('#global-search')).toBeFocused();
});

test('searching a site name navigates to that site', async ({ page }) => {
	await signIn(page);
	await page.keyboard.press('Control+k');
	await page.locator('#global-search').fill(SEEDED_SITE);
	const hit = page.getByRole('button', { name: SEEDED_SITE, exact: true });
	await hit.click();
	await page.waitForURL(new RegExp(`${BASE_PATH}/sites/[0-9a-f-]{36}`));
	await expect(page.getByRole('heading', { name: SEEDED_SITE })).toBeVisible();
});
