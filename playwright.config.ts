import { defineConfig, devices } from '@playwright/test';

// The browser suite drives its own dev server against the browser API on :3006, which holds its
// own database on the tmpfs test server, so a story's fixtures never land on the dev stack a
// person browses. Keycloak is the dev one (the seeded `river-data` realm on :8180). It tests this
// checkout rather than whatever the compose UI container is serving, and is not part of
// `npm test`. The dev server is reused if one already holds the port, so the global setup asks it
// which checkout it serves and refuses one that is not this tree.
//   cd river-data-ui && docker compose up -d river-browser-api river-db-keycloak
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
	globalSetup: './tests/browser/global-setup.ts',
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
					VITE_API_PROXY_TARGET: process.env.E2E_API_URL ?? 'http://localhost:3006',
					VITE_KEYCLOAK_BROWSER_URL: process.env.E2E_KEYCLOAK_URL ?? 'http://localhost:8180/',
				},
			},
});
