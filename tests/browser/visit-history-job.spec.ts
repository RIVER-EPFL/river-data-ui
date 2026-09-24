import { expect, test } from '@playwright/test';
import { BASE_PATH, signIn } from './portal';
import { seedComputedVisit } from './computedVisit';
import { sheetCell } from './sheet';

// Scenario: a computed value's record, opened inside its visit, lists the recompute job that wrote
// it; the reader opens that job from the history and comes back.
//
// Expected behaviour: Open shows that job's detail whatever page of the jobs list it is on, and
// Back returns to the same visit with the same record open.

test('a history job opens on its detail and Back returns to the open visit and record', async ({
	page,
	request,
}) => {
	const visit = await seedComputedVisit(request, 'b683', 5);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${visit.siteId}?tab=visits`);
	await expect(page.getByText('1 visit', { exact: true })).toBeVisible();

	await sheetCell(page, new RegExp(`^${visit.outputName} at`)).dblclick();
	await expect(page).toHaveURL(new RegExp(`event=${visit.eventId}&parameter=`));
	const history = page.getByRole('region', { name: 'History' }).first();
	if (!(await history.isVisible())) await page.getByText('Details').first().click();
	const open = history.getByRole('link', { name: 'Open' }).and(page.getByTitle('Open this job and its log'));
	await open.first().click();

	await expect(page).toHaveURL(/\/system\?tab=jobs&job=/);
	await expect(page.getByRole('dialog', { name: 'Job Detail' })).toBeVisible();
	await expect(page.getByRole('dialog', { name: 'Job Detail' })).toContainText('Timeline');

	await page.goBack();
	await expect(page).toHaveURL(new RegExp(`event=${visit.eventId}&parameter=`));
	await expect(page.getByText(/parameters filled/)).toBeVisible();
	await expect(page.getByRole('region', { name: 'History' }).first()).toBeVisible();
	await expect(page.getByRole('button', { name: 'Close' }).first()).toBeVisible();
});
