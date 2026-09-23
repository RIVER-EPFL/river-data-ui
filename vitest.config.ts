import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const alias = {
	$lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
	$components: fileURLToPath(new URL('./src/lib/components', import.meta.url)),
	$api: fileURLToPath(new URL('./src/lib/api', import.meta.url)),
	$auth: fileURLToPath(new URL('./src/lib/auth', import.meta.url)),
	$schemas: fileURLToPath(new URL('./src/lib/schemas', import.meta.url)),
	$app: fileURLToPath(new URL('./src/tests/app-stubs', import.meta.url)),
};

// A zone with a daylight-saving offset, so a test whose subject is the timezone preference sees a
// browser zone that differs from UTC wherever the suite runs.
const TIMEZONE = { TZ: 'Europe/Zurich' };

export default defineConfig({
	resolve: { alias },
	define: { __APP_VERSION__: JSON.stringify('test') },
	test: {
		projects: [
			{
				// The svelte plugin compiles `.svelte.ts` rune modules, which several helpers import.
				plugins: [svelte()],
				resolve: { alias },
				define: { __APP_VERSION__: JSON.stringify('test') },
				test: {
					name: 'unit',
					environment: 'node',
					env: TIMEZONE,
					include: ['src/**/*.test.ts', 'tests/browser/*.test.ts'],
					exclude: ['src/**/*.svelte.test.ts'],
				},
			},
			{
				plugins: [svelte(), svelteTesting()],
				resolve: { alias, conditions: ['browser'] },
				define: { __APP_VERSION__: JSON.stringify('test') },
				test: {
					name: 'component',
					environment: 'jsdom',
					env: TIMEZONE,
					// A component that mounts Handsontable or uPlot pays for its import in the first case of
					// its file, which outlasts the five-second default on a loaded machine.
					testTimeout: 40_000,
					include: ['src/**/*.svelte.test.ts'],
					setupFiles: ['src/tests/setup.ts'],
				},
			},
		],
	},
});
