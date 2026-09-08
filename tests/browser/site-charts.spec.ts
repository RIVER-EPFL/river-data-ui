import { expect, test, type Page } from '@playwright/test';
import { BASE_PATH, SEEDED_SITE, signIn } from './portal';

async function openSeededSite(page: Page) {
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites`);
	await page.getByRole('link', { name: SEEDED_SITE, exact: true }).first().click();
	await page.waitForURL(new RegExp(`${BASE_PATH}/sites/[0-9a-f-]{36}`));
}

async function plotBox(page: Page, index: number) {
	const plot = page.locator('.u-over').nth(index);
	await expect(plot).toBeVisible();
	await plot.scrollIntoViewIfNeeded();
	return (await plot.boundingBox())!;
}

test('hovering a site chart raises the shared tooltip', async ({ page }) => {
	await openSeededSite(page);
	const box = await plotBox(page, 0);
	await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);

	const tooltip = page.getByTestId('chart-tooltip');
	await expect(tooltip).toBeVisible();
	await expect(tooltip).toContainText(/\d{2}:\d{2}/);

	await page.mouse.move(box.x - 40, box.y - 40);
	await expect(tooltip).toBeHidden();
});

test('one tooltip serves every chart on the site', async ({ page }) => {
	await openSeededSite(page);
	await plotBox(page, 0);
	expect(await page.locator('.u-over').count()).toBeGreaterThan(1);

	const box = await plotBox(page, 1);
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await expect(page.getByTestId('chart-tooltip')).toHaveCount(1);
});

test('dragging across a chart moves the whole site to that window', async ({ page }) => {
	await openSeededSite(page);
	const label = page.getByTestId('chart-window-label');
	const before = await label.innerText();

	const box = await plotBox(page, 0);
	const y = box.y + box.height / 2;
	await page.mouse.move(box.x + box.width * 0.3, y);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.7, y, { steps: 10 });
	await page.mouse.up();

	await expect(label).not.toHaveText(before);
});
