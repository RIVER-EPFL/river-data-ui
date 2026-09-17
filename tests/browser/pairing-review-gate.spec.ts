import { expect, test, type APIRequestContext } from '@playwright/test';
import { API_URL, BASE_PATH, signIn, token } from './portal';

// Scenario: the review of a plan whose source holds deferred audit findings and a replicate family
// with no sd divisor declared. Expected behaviour: the review tabs count neither,
// since discrepancies are tagged on the data rather than reviewed and the divisor is no choice.

async function seedPlan(
	request: APIRequestContext,
	parameter = 'Turbidity',
	others: string[] = [],
): Promise<{ planId: string; sourceSystem: string; stamp: string }> {
	const stamp = `${Date.now()}`;
	const sourceSystem = `audits_${stamp}`;
	const headers = { Authorization: `Bearer ${await token(request)}` };
	const post = async (path: string, data: unknown) => {
		const response = await request.post(`${API_URL}/api${path}`, { headers, data });
		expect(response.ok(), `${path} -> ${response.status()} ${await response.text()}`).toBeTruthy();
		return response.json();
	};
	await post('/streams/register', {
		source_system: sourceSystem,
		source_key: `${sourceSystem}:grab_params:Audit Gauging Station`,
		measurement_type: 'spot',
		metadata: {
			hierarchy: { project: `Audits ${stamp}`, site: `Audit Gauging Station ${stamp}`, parameter },
			units: 'NTU',
			replicates: {
				source_columns: ['turb_rep_1', 'turb_rep_2'],
				portal_mean_column: 'turb_avg',
				portal_sd_column: 'turb_sd',
			},
		},
	});
	for (const other of others) {
		await post('/streams/register', {
			source_system: sourceSystem,
			source_key: `${sourceSystem}:grab_params:${other}`,
			measurement_type: 'spot',
			metadata: {
				hierarchy: { project: `Audits ${stamp}`, site: `Audit Gauging Station ${stamp}`, parameter: other },
				units: 'NTU',
			},
		});
	}
	const plan = await post('/sync/pairing-plans', { source_system: sourceSystem });
	return { planId: plan.id, sourceSystem, stamp };
}

test('the apply gate counts neither deferred audits nor undeclared sd divisors', async ({
	page,
	request,
}) => {
	const { planId, sourceSystem } = await seedPlan(request);
	// Deferred holds for this source, which a sync run this story does not drive would raise.
	await page.route(
		(url) =>
			url.pathname.endsWith('/api/sync/replicate_audit_holds') &&
			url.searchParams.get('source_system') === sourceSystem &&
			url.searchParams.get('status') === 'deferred',
		(route) => route.fulfill({ json: { data: [], total: 3, page: 1, page_size: 1, pending: 0 } }),
	);
	await signIn(page);
	await page.goto(`${BASE_PATH}/streams?step=review&plan=${planId}`);

	await expect(page.getByRole('button', { name: /^Sites 0 of 1 reviewed/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /^Audits\s/ })).toHaveCount(0);
	await expect(page.getByRole('button', { name: /^sd divisors\s/ })).toHaveCount(0);
});

// Scenario: a first plan whose one feed arrives with a suggested instrument nobody confirmed.
// Expected behaviour: the Instruments tab counts it as still to decide, and "Mark all reviewed"
// confirms it without leaving the tab.
test('marking every instrument reviewed confirms the suggested instrument', async ({
	page,
	request,
}) => {
	const { planId } = await seedPlan(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/streams?step=review&plan=${planId}`);

	await page.getByRole('button', { name: /^Instruments 0 of 1 reviewed/ }).click();
	await expect(page.getByRole('button', { name: 'Mark reviewed', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Mark all reviewed' }).click();

	await expect(page.getByRole('button', { name: '✓ Reviewed' })).toBeVisible();
	await expect(page.getByRole('button', { name: /^Instruments 1 of 1 reviewed/ })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Mark all reviewed' })).toBeDisabled();
});

// Scenario: a first plan, where the project, site, parameter and instrument all come from the
// source's own labels. Expected behaviour: each is renamed in the review, and the names are the
// plan's after it is closed and reopened.
test('renames the project, site, parameter and instrument a plan creates', async ({ page, request }) => {
	const parameter = `Rename probe ${Date.now()}`;
	const { planId, stamp } = await seedPlan(request, parameter);
	const project = `Audits ${stamp}`;
	const site = `Audit Gauging Station ${stamp}`;
	const renamed = {
		project: `Renamed project ${stamp}`,
		site: `Renamed site ${stamp}`,
		parameter: `renamed_probe_${stamp}`,
		instrument: `Renamed instrument ${stamp}`,
	};
	await signIn(page);
	const review = `${BASE_PATH}/streams?step=review&plan=${planId}`;
	await page.goto(review);

	await page.getByRole('button', { name: /^Projects / }).click();
	await page.getByLabel(`Project for ${project}`).selectOption({ label: 'Custom name…' });
	await page.getByLabel(`New name for ${project}`).fill(renamed.project);
	await page.getByLabel(`New name for ${project}`).press('Enter');

	await page.getByRole('button', { name: /^Sites / }).click();
	await page.getByLabel(`Site for ${site}`).selectOption({ label: 'Custom name…' });
	await page.getByLabel(`New name for ${site}`).fill(renamed.site);
	await page.getByLabel(`New name for ${site}`).press('Enter');

	await page.getByRole('button', { name: /^Parameters / }).click();
	await page.getByLabel(`Parameter for ${parameter}`).selectOption({ label: 'Custom name…' });
	await page.getByLabel(`New name for ${parameter}`).fill(renamed.parameter);
	await page.getByLabel(`New name for ${parameter}`).press('Enter');

	await page.getByRole('button', { name: /^Instruments / }).click();
	const instrument = page.getByLabel(/^Instrument for /).first();
	const suggestion = (await instrument.locator('option:checked').textContent())!.replace(/^\+ /, '').trim();
	await instrument.selectOption({ label: 'Custom name…' });
	await page.getByLabel(`New name for ${suggestion}`).fill(renamed.instrument);
	await page.getByLabel(`New name for ${suggestion}`).press('Enter');
	await expect(instrument.locator('option:checked')).toHaveText(`+ ${renamed.instrument}`);

	await page.getByRole('button', { name: /Go back and resume later/ }).click();
	await page.goto(review);

	await page.getByRole('button', { name: /^Projects / }).click();
	await expect(page.getByLabel(`Project for ${renamed.project}`)).toBeVisible();
	await page.getByRole('button', { name: /^Sites / }).click();
	await expect(page.getByLabel(`Site for ${renamed.site}`)).toBeVisible();
	await page.getByRole('button', { name: /^Parameters / }).click();
	await expect(page.getByLabel(`Parameter for ${renamed.parameter}`)).toBeVisible();
	await page.getByRole('button', { name: /^Instruments / }).click();
	await expect(page.getByLabel(/^Instrument for /).first().locator('option:checked')).toHaveText(`+ ${renamed.instrument}`);
});

// Scenario: a first plan, reviewed a tab at a time. Expected behaviour: "Mark all reviewed" on
// Sites marks the sites and nothing on the other tabs, Undo takes it back, which a reload confirms
// was saved, and "Mark all unreviewed" is offered once there is something to take back.
test('marking every site reviewed stays on its tab and can be undone', async ({ page, request }) => {
	const { planId } = await seedPlan(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/streams?step=review&plan=${planId}`);

	await page.getByRole('button', { name: /^Sites / }).click();
	await page.getByRole('button', { name: 'Mark all reviewed' }).click();
	await expect(page.getByText('Marked 1 site reviewed')).toBeVisible();
	await expect(page.getByRole('button', { name: /^Sites 1 of 1 reviewed/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /^Projects 0 of 1 reviewed/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /^Parameters 0 of 1 reviewed/ })).toBeVisible();

	await page.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(page.getByRole('button', { name: /^Sites 0 of 1 reviewed/ })).toBeVisible();
	await page.reload();
	await expect(page.getByRole('button', { name: /^Sites 0 of 1 reviewed/ })).toBeVisible();

	await expect(page.getByRole('button', { name: 'Mark all unreviewed' })).toBeDisabled();
	await page.getByRole('button', { name: 'Mark all reviewed' }).click();
	await page.getByRole('button', { name: 'Mark all unreviewed' }).click();
	await expect(page.getByText('Marked 1 site unreviewed')).toBeVisible();
	await expect(page.getByRole('button', { name: /^Sites 0 of 1 reviewed/ })).toBeVisible();
});

// Scenario: a first plan whose Turbidity feed will be measured by an instrument the plan creates.
// Expected behaviour: Parameters and each stream on Sites name that instrument and open its row on
// Instruments, and the row links back to the parameter and the site it covers.
test('the parameter, the stream and the instrument name one another', async ({ page, request }) => {
	const { planId, stamp } = await seedPlan(request);
	const site = `Audit Gauging Station ${stamp}`;
	await signIn(page);
	await page.goto(`${BASE_PATH}/streams?step=review&plan=${planId}`);

	await page.getByRole('button', { name: /^Parameters / }).click();
	await expect(page.getByRole('columnheader', { name: 'Instrument' })).toBeVisible();
	await page.getByRole('button', { name: '+ Turbidity', exact: true }).click();
	await expect(page.getByRole('button', { name: /^Instruments / })).toHaveClass(/bg-brand-primary/);
	await expect(page.getByRole('combobox', { name: 'Instrument for Turbidity' })).toBeVisible();

	await page.getByRole('button', { name: site }).click();
	await expect(page.getByRole('combobox', { name: `Site for ${site}` })).toBeVisible();
	await expect(page.getByRole('button', { name: '+ Turbidity', exact: true })).toBeVisible();

	await page.getByRole('button', { name: '+ Turbidity', exact: true }).click();
	await page.getByRole('button', { name: 'Turbidity', exact: true }).click();
	await expect(page.getByRole('combobox', { name: 'Parameter for Turbidity' })).toBeVisible();
});

// Scenario: a plan proposing an instrument for Turbidity and one for Turbidity_T, where the reviewer
// knows one turbidimeter measures both and picks Turbidity's instrument for Turbidity_T.
// Expected behaviour: the Instruments tab keeps one row covering both parameters, and Sites and
// Parameters name that one instrument for both.
test('choosing another planned instrument joins the two', async ({ page, request }) => {
	const { planId } = await seedPlan(request, 'Turbidity', ['Turbidity_T']);
	await signIn(page);
	await page.goto(`${BASE_PATH}/streams?step=review&plan=${planId}`);

	await page.getByRole('button', { name: /^Instruments / }).click();
	await expect(page.getByRole('combobox', { name: /^Instrument for / })).toHaveCount(2);
	await page.getByRole('combobox', { name: 'Instrument for Turbidity_T' }).selectOption('new:Turbidity');

	await expect(page.getByRole('combobox', { name: /^Instrument for / })).toHaveCount(1);
	const row = page.getByRole('combobox', { name: 'Instrument for Turbidity, Turbidity_T' }).locator('xpath=ancestor::tr');
	await expect(row.getByRole('button', { name: 'Turbidity', exact: true })).toBeVisible();
	await expect(row.getByRole('button', { name: 'Turbidity_T', exact: true })).toBeVisible();

	await page.getByRole('button', { name: /^Parameters / }).click();
	await expect(page.getByRole('button', { name: '+ Turbidity', exact: true })).toHaveCount(2);
	await expect(page.getByRole('button', { name: '+ Turbidity_T', exact: true })).toHaveCount(0);

	await page.getByRole('button', { name: /^Sites / }).click();
	await page.getByRole('button', { name: 'Expand', exact: true }).click();
	await expect(page.getByRole('button', { name: '+ Turbidity', exact: true })).toHaveCount(2);
});

// Scenario: a source with an open draft, discarded from the source list. Expected behaviour: the
// first press only turns the button into its confirmation, which reads in the row rather than in a
// panel the table would clip, and the second press discards the draft.
test('discarding a draft asks by changing the button', async ({ page, request }) => {
	const { sourceSystem } = await seedPlan(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/streams`);
	await expect(page.getByRole('heading', { name: 'Sync services' })).toBeVisible();
	await expect(page).toHaveURL(/tab=pair/);

	const row = page.getByRole('row').filter({ hasText: sourceSystem });
	await row.getByRole('button', { name: 'Discard', exact: true }).click();
	await expect(row.getByRole('button', { name: 'Resume' })).toBeVisible();
	await row.getByRole('button', { name: 'Click again to discard' }).click();
	await expect(page.getByText('Draft discarded')).toBeVisible();
	await expect(row.getByRole('button', { name: 'Resume' })).toHaveCount(0);
});
