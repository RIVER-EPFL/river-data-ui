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
					include: ['src/**/*.test.ts'],
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
					include: ['src/**/*.svelte.test.ts'],
					setupFiles: ['src/tests/setup.ts'],
				},
			},
		],
	},
});
