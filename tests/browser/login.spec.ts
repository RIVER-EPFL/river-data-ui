import { expect, test } from '@playwright/test';
import { BASE_PATH, LOGIN_URL, signIn } from './portal';

test('an unauthenticated visitor gets the landing page, not the dashboard', async ({ page }) => {
	await page.goto(`${BASE_PATH}/`);
	await expect(page.getByRole('heading', { name: 'RIVER Data', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Logout' })).toHaveCount(0);
});

test('the sign-in button reaches the seeded realm', async ({ page }) => {
	await page.goto(`${BASE_PATH}/`);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(LOGIN_URL);
	await expect(page.locator('#username')).toBeVisible();
});

test('signing in lands on the dashboard', async ({ page }) => {
	await signIn(page);
	expect(new URL(page.url()).pathname).toBe(`${BASE_PATH}/`);
	await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();
});

test('logout returns to the landing page under the base path', async ({ page }) => {
	await signIn(page);
	await page.getByRole('button', { name: 'Logout' }).click();
	await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Logout' })).toHaveCount(0);
	expect(new URL(page.url()).pathname).toBe(`${BASE_PATH}/`);
});
