import { expect, test, type APIRequestContext } from '@playwright/test';
import { API_URL, BASE_PATH, signIn, token } from './portal';

// Scenario: the review of a plan whose source holds deferred audit findings and a replicate family
// with no sd divisor declared. Expected behaviour: the "Before you apply" strip counts neither,
// since discrepancies are tagged on the data rather than reviewed and the divisor is no choice.

async function seedPlan(request: APIRequestContext): Promise<{ planId: string; sourceSystem: string }> {
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
			hierarchy: { project: `Audits ${stamp}`, site: `Audit Gauging Station ${stamp}`, parameter: 'Turbidity' },
			units: 'NTU',
			replicates: {
				source_columns: ['turb_rep_1', 'turb_rep_2'],
				portal_mean_column: 'turb_avg',
				portal_sd_column: 'turb_sd',
			},
		},
	});
	const plan = await post('/sync/pairing-plans', { source_system: sourceSystem });
	return { planId: plan.id, sourceSystem };
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

	await expect(page.getByText('Before you apply')).toBeVisible();
	await expect(page.getByRole('button', { name: /^Rows\s/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /^Audits\s/ })).toHaveCount(0);
	await expect(page.getByRole('button', { name: /^sd divisors\s/ })).toHaveCount(0);
});

// Scenario: a first plan whose one feed arrives with a suggested instrument nobody confirmed.
// Expected behaviour: the Instruments tab counts it as still to decide, and one "Accept all
// suggestions" confirms it without leaving the tab.
test('accepting every suggested instrument at once clears the instruments still to decide', async ({
	page,
	request,
}) => {
	const { planId } = await seedPlan(request);
	await signIn(page);
	await page.goto(`${BASE_PATH}/streams?step=review&plan=${planId}`);

	await page.getByRole('button', { name: /^Instruments \(1 to decide\)/ }).click();
	await expect(page.getByText('proposed', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Accept all suggestions' }).click();

	await expect(page.getByText('will be created', { exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Accept all suggestions' })).toHaveCount(0);
});
