import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { API_URL, BASE_PATH, SEEDED_SITE, signIn, token } from './portal';

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

const CHARTS = 6;
const REPLICATES = [11.2, 11.6, 12.1];

/**
 * A site with `CHARTS` spot parameters, each measured once in triplicate at the same instant, so
 * every chart carries one marker and the last of them is below the fold.
 */
async function seedSpotSite(request: APIRequestContext) {
	const stamp = `${Date.now()}`;
	const headers = { Authorization: `Bearer ${await token(request)}` };
	const post = async (path: string, data: unknown) => {
		const response = await request.post(`${API_URL}/api${path}`, { headers, data });
		expect(response.ok(), `${path} -> ${response.status()} ${await response.text()}`).toBeTruthy();
		return response.json();
	};
	const siteName = `Charts ${stamp}`;
	const project = await post('/projects', { name: siteName });
	const site = await post('/sites', { name: siteName, project_id: project.id });
	const at = Date.UTC(2026, 0, 15, 9);
	const time = new Date(at).toISOString().replace(/\.\d+Z$/, 'Z');
	for (let c = 0; c < CHARTS; c += 1) {
		const code = `m254_${stamp}_${c}`;
		const parameter = await post('/parameters', { code, name: code, category: 'measurement', aliases: [] });
		await post('/site_parameters', { site_id: site.id, parameter_id: parameter.id, name: code });
		await post('/grab_samples', {
			site_id: site.id,
			mode: 'replace',
			readings: REPLICATES.map((value, replicate_index) => ({
				parameter_id: parameter.id,
				value,
				time,
				replicate_index,
			})),
		});
	}
	return { siteId: site.id, at };
}

/** The seeded site, windowed on a day around its measurement so the markers are drawn. */
async function openSpotSite(page: Page, request: APIRequestContext) {
	const { siteId, at } = await seedSpotSite(request);
	await signIn(page);
	const start = at - 43_200_000;
	const end = at + 43_200_000;
	await page.goto(
		`${BASE_PATH}/sites/${siteId}?start=${new Date(start).toISOString()}&end=${new Date(end).toISOString()}`,
	);
	await expect(page.locator('.u-over')).toHaveCount(CHARTS);
	await expect(page.getByTestId('chart-window-label')).toHaveText(/1d/);
}

/**
 * Click the one spot marker on chart `index`, scrolling it into view. Hovering anywhere snaps
 * uPlot's cursor point onto the reading, which is where the chart's own hit test answers.
 */
async function clickTheMarker(page: Page, index: number) {
	const plot = page.locator('.u-over').nth(index);
	await plot.scrollIntoViewIfNeeded();
	const box = (await plot.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	const point = plot.locator('.u-cursor-pt').filter({ visible: true }).first();
	const at = (await point.boundingBox())!;
	await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
	await expect.poll(() => plot.evaluate((el) => el.style.cursor)).toBe('pointer');
	await page.mouse.down();
	await page.mouse.up();
	await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();
}

// Scenario: a reader scrolled down a site's charts clicks a point on one of them.
//
// Expected behaviour: the record unfolds under that chart. Nothing else moves: the page is not
// rebuilt, the site is not refetched, the scroll stays put and no chart's window changes.
test('clicking a point unfolds its record without rebuilding the page', async ({ page, request }) => {
	await openSpotSite(page, request);
	const label = page.getByTestId('chart-window-label');
	const shown = await label.innerText();

	const siteReads: string[] = [];
	page.on('request', (r) => {
		if (/\/api\/sites\/[0-9a-f-]{36}(\?|$)/.test(r.url())) siteReads.push(r.url());
	});
	await page.evaluate(() => {
		document.querySelectorAll('.u-over').forEach((el, n) => el.setAttribute('data-plot', `${n}`));
	});
	const plots = await page.locator('.u-over').count();

	await clickTheMarker(page, CHARTS - 1);
	const record = page.getByRole('button', { name: 'Close' });
	const scrolled = await page.evaluate(() => document.querySelector('main')!.scrollTop);
	expect(scrolled, 'the reader is partway down the page').toBeGreaterThan(0);

	expect(await page.locator('.u-over[data-plot]').count(), 'the charts were not rebuilt').toBe(plots);
	await expect(label).toHaveText(shown);
	expect(siteReads, 'the site was not refetched').toEqual([]);

	await record.click();
	await expect(record).toBeHidden();
	expect(await page.locator('.u-over[data-plot]').count()).toBe(plots);
	// Closing shortens the page, so the scroll is where it was unless the page no longer reaches it.
	const after = await page.evaluate(() => {
		const main = document.querySelector('main')!;
		return { top: main.scrollTop, max: main.scrollHeight - main.clientHeight };
	});
	expect(after.top).toBe(Math.min(scrolled, after.max));
	await expect(label).toHaveText(shown);
	expect(siteReads).toEqual([]);
});

// The record a scientist lands on is the value, not a page of provenance.
test('the record opens as a summary strip with everything else collapsed', async ({ page, request }) => {
	await openSpotSite(page, request);
	await clickTheMarker(page, 0);
	const record = page.getByTestId('point-record');
	await expect(record.getByText('Replicates', { exact: true })).toBeVisible();

	const disclosures = await record.evaluate((panel) =>
		[...panel.querySelectorAll('details > summary')]
			.filter((s) => s.textContent!.trim() === 'Details')
			.map((s) => (s.parentElement as HTMLDetailsElement).open),
	);
	expect(disclosures, 'one disclosure, closed, holds everything but the strip').toEqual([false]);

	// The strip is the value, the statistics, the instrument, the computation and the actions:
	// what a reader takes in without scrolling. The panel below it is bounded, so unfolding the
	// details never pushes the next chart off the screen.
	const size = await page.evaluate(() => {
		const panel = document.querySelector('[data-testid="point-record"]')!;
		const actions = panel.querySelector('[aria-label="Actions"]')!;
		return {
			panel: panel.getBoundingClientRect().height,
			strip: actions.getBoundingClientRect().bottom - panel.getBoundingClientRect().top,
			viewport: window.innerHeight,
		};
	});
	expect(size.panel).toBeLessThanOrEqual(size.viewport * 0.7 + 1);
	expect(size.strip).toBeLessThan(size.viewport / 2);

	await page.mouse.move(0, 0);
	await record.scrollIntoViewIfNeeded();
	await page.screenshot({ path: 'test-results/point-record.png' });
});
