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

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

type Spec = (typeof PARAMETERS)[number];

/** One reading per hour for each parameter, from `from` up to now. */
function hourlyReadings(siteId: string, parameters: { id: string; spec: Spec }[], from: number) {
	const readings = [];
	const hours = Math.floor((Date.now() - from) / HOUR_MS);
	for (const { id, spec } of parameters) {
		for (let hour = 0; hour <= hours; hour += 1) {
			const at = from + hour * HOUR_MS;
			readings.push({
				site_id: siteId,
				parameter_id: id,
				time: new Date(at).toISOString(),
				raw_value: spec.base + spec.swing * Math.sin(at / HOUR_MS / 6),
				replicate_index: 0,
				measurement_type: 'continuous',
			});
		}
	}
	return readings;
}

export default async function globalSetup(config: FullConfig) {
	const request = await playwrightRequest.newContext();
	const baseUrl = config.projects[0]?.use.baseURL;
	if (baseUrl) await assertOwnServer(request, baseUrl);
	await waitForApi(request);

	const headers = { Authorization: `Bearer ${await token(request)}` };
	const get = async (path: string) => {
		const response = await request.get(`${API_URL}/api${path}`, { headers });
		expect(response.ok(), `${path} -> ${response.status()}`).toBeTruthy();
		return response.json();
	};
	const post = async (path: string, data: unknown) => {
		const response = await request.post(`${API_URL}/api${path}`, { headers, data });
		expect(response.ok(), `${path} -> ${response.status()} ${await response.text()}`).toBeTruthy();
		return response.json();
	};
	const filtered = (field: string, value: string) =>
		encodeURIComponent(JSON.stringify({ [field]: value }));

	// A site seeded by an earlier run is brought up to now, so a story reading the last day of it
	// reads data whenever it runs.
	const [standing] = (await get(`/sites?filter=${filtered('name', SEEDED_SITE)}`)) as { id: string }[];
	if (standing) {
		const detail = await get(`/sites/${standing.id}/detail`);
		const latest = detail.data_end ? Date.parse(detail.data_end) : 0;
		if (Date.now() - latest > DAY_MS) {
			const parameters = [];
			for (const spec of PARAMETERS) {
				const [parameter] = await get(`/parameters?filter=${filtered('code', spec.code)}`);
				if (parameter) parameters.push({ id: parameter.id as string, spec });
			}
			const from = Math.max(latest + HOUR_MS, Date.now() - DAYS * DAY_MS);
			await post('/readings/batch', { readings: hourlyReadings(standing.id, parameters, from) });
		}
		await request.dispose();
		return;
	}

	const project = await post('/projects', { name: 'BREATHE' });
	const site = await post('/sites', {
		name: SEEDED_SITE,
		project_id: project.id,
		latitude: 46.1,
		longitude: 7.07,
	});

	const parameters = [];
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
		parameters.push({ id: parameter.id as string, spec });
	}
	await post('/readings/batch', {
		readings: hourlyReadings(site.id, parameters, Date.now() - DAYS * DAY_MS),
	});
	await request.dispose();
}
