import { expect, test, type APIRequestContext } from '@playwright/test';
import { API_URL, BASE_PATH, signIn, token } from './portal';

// Scenario: an alarm is open and the person on call has only a phone. Expected behaviour: the
// alarm log scrolls sideways inside its box and the Acknowledge action stays on screen.

const PHONE = { width: 375, height: 812 };

async function seedOpenAlarm(request: APIRequestContext): Promise<string> {
	const stamp = `${Date.now()}`;
	const headers = { Authorization: `Bearer ${await token(request)}` };
	const post = async (path: string, data: unknown) => {
		const response = await request.post(`${API_URL}/api${path}`, { headers, data });
		expect(response.ok(), `${path} -> ${response.status()} ${await response.text()}`).toBeTruthy();
		return response.json();
	};

	const project = await post('/projects', { name: `Alarm phone ${stamp}` });
	const site = await post('/sites', { name: `Alarm phone ${stamp}`, project_id: project.id });
	const parameter = await post('/parameters', {
		code: `alarm_phone_${stamp}`,
		name: `Alarm phone ${stamp}`,
		category: 'measurement',
		aliases: [],
	});
	await post('/site_parameters', { site_id: site.id, parameter_id: parameter.id, name: parameter.name });
	await post('/alarm_thresholds', { parameter_id: parameter.id, site_id: site.id, alarm_max: 10 });
	const time = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
	await post('/grab_samples', {
		site_id: site.id,
		mode: 'replace',
		readings: [{ parameter_id: parameter.id, value: 99, time, replicate_index: 0 }],
	});
	await post('/actions/reconcile_alarms', {});
	await expect
		.poll(async () => {
			const response = await request.get(`${API_URL}/api/alarms/events?site_id=${site.id}`, { headers });
			return ((await response.json()).events ?? []).length;
		})
		.toBeGreaterThan(0);
	return site.name;
}

test('an open alarm can be acknowledged from a phone', async ({ page, request }) => {
	const siteName = await seedOpenAlarm(request);
	await page.setViewportSize(PHONE);
	await signIn(page);
	await page.goto(`${BASE_PATH}/alarms`);

	const row = page.getByRole('row').filter({ hasText: siteName });
	const acknowledge = row.getByRole('button', { name: 'Acknowledge' });
	await expect(acknowledge).toBeVisible();
	const box = (await acknowledge.boundingBox())!;
	expect(box.x, 'the action starts on screen').toBeGreaterThanOrEqual(0);
	expect(box.x + box.width, 'and ends on screen').toBeLessThanOrEqual(PHONE.width);
	await acknowledge.click();
	await expect(row.getByRole('button', { name: 'Unacknowledge' })).toBeVisible();
});
