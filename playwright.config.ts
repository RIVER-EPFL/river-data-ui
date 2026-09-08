import { defineConfig, devices } from '@playwright/test';

// The browser suite drives its own dev server against the dev compose stack's API, database and
// Keycloak (the seeded `river-data` realm on :8180), so it tests this checkout rather than
// whatever the compose UI container is serving. It is not part of `npm test`.
//   cd river-data-ui && docker compose up -d river-data-api river-db-timescale river-db-keycloak
//   npm run test:browser
const PORT = Number(process.env.E2E_PORT ?? 5174);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
	testDir: 'tests/browser',
	timeout: 60_000,
	expect: { timeout: 15_000 },
	workers: 1,
	forbidOnly: !!process.env.CI,
	reporter: [['list']],
	use: {
		baseURL: BASE_URL,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: process.env.E2E_BASE_URL
		? undefined
		: {
				command: `npm run dev -- --port ${PORT} --strictPort`,
				url: `${BASE_URL}/admin/`,
				reuseExistingServer: true,
				timeout: 120_000,
				env: {
					VITE_API_PROXY_TARGET: process.env.E2E_API_URL ?? 'http://localhost:3005',
					VITE_KEYCLOAK_BROWSER_URL: process.env.E2E_KEYCLOAK_URL ?? 'http://localhost:8180/',
				},
			},
});
