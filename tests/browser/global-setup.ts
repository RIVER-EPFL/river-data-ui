import { expect, request as playwrightRequest, type FullConfig } from '@playwright/test';
import { foreignServerRefusal, type Checkout } from './checkout';
import { API_URL, BASE_PATH, SEEDED_SITE, token } from './portal';

// The browser suite runs against its own API and its own database, which starts empty. The
// stories that read a site by name (the charts, the global search, the map) need one standing
// before the first test, so it is seeded here rather than assumed to be somebody's real data.

const PARAMETERS = [
	{ code: 'depth', name: 'Depth', units: 'mm', base: 2000, swing: 120 },
	{ code: 'water_temperature', name: 'Water temperature', units: '°C', base: 8, swing: 3 },
];
const DAYS = 7;

async function waitForApi(request: Awaited<ReturnType<typeof playwrightRequest.newContext>>) {
	const deadline = Date.now() + 10 * 60_000;
	for (;;) {
		const response = await request.get(`${API_URL}/healthz`).catch(() => null);
		if (response?.ok()) return;
		if (Date.now() > deadline) {
			throw new Error(`the browser API at ${API_URL} never became healthy`);
		}
		await new Promise((resolve) => setTimeout(resolve, 2_000));
	}
}

/** Refuse a dev server Playwright reused from another checkout, before any story runs. */
async function assertOwnServer(
	request: Awaited<ReturnType<typeof playwrightRequest.newContext>>,
	baseUrl: string,
) {
	const response = await request.get(`${baseUrl}${BASE_PATH}/__checkout`).catch(() => null);
	// A server that does not carry the route answers with the SPA's index.html, which is a 200.
	const reported = response?.ok() ? ((await response.json().catch(() => null)) as Checkout) : null;
	const refusal = foreignServerRefusal(baseUrl, process.cwd(), reported);
	if (refusal) throw new Error(refusal);
}

export default async function globalSetup(config: FullConfig) {
	const request = await playwrightRequest.newContext();
	const baseUrl = config.projects[0]?.use.baseURL;
	if (baseUrl) await assertOwnServer(request, baseUrl);
	await waitForApi(request);

	const headers = { Authorization: `Bearer ${await token(request)}` };
	const filter = encodeURIComponent(JSON.stringify({ name: SEEDED_SITE }));
	const standing = await request.get(`${API_URL}/api/sites?filter=${filter}`, { headers });
	expect(standing.ok(), `sites -> ${standing.status()}`).toBeTruthy();
	if (((await standing.json()) as unknown[]).length > 0) {
		await request.dispose();
		return;
	}

	const post = async (path: string, data: unknown) => {
		const response = await request.post(`${API_URL}/api${path}`, { headers, data });
		expect(response.ok(), `${path} -> ${response.status()} ${await response.text()}`).toBeTruthy();
		return response.json();
	};

	const project = await post('/projects', { name: 'BREATHE' });
	const site = await post('/sites', {
		name: SEEDED_SITE,
		project_id: project.id,
		latitude: 46.1,
		longitude: 7.07,
	});

	const hourly = Date.now() - DAYS * 24 * 3_600_000;
	const readings = [];
	for (const spec of PARAMETERS) {
		const parameter = await post('/parameters', {
			code: spec.code,
			name: spec.name,
			category: 'measurement',
			aliases: [],
		});
		await post('/site_parameters', {
			site_id: site.id,
			parameter_id: parameter.id,
			name: spec.name,
			units: spec.units,
		});
		for (let hour = 0; hour < DAYS * 24; hour += 1) {
			readings.push({
				site_id: site.id,
				parameter_id: parameter.id,
				time: new Date(hourly + hour * 3_600_000).toISOString(),
				raw_value: spec.base + spec.swing * Math.sin(hour / 6),
				replicate_index: 0,
				measurement_type: 'continuous',
			});
		}
	}
	await post('/readings/batch', { readings });
	await request.dispose();
}
