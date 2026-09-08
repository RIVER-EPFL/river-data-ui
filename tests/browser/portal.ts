import { expect, type Page } from '@playwright/test';

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
