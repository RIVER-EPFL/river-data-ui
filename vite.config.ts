import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

// Baked into the bundle as `__APP_VERSION__`. CI passes BUILD_VERSION (git tag on prod, short SHA
// on dev); local/dev builds fall back to the package.json version with a `-dev` suffix.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
const appVersion = process.env.BUILD_VERSION || `${pkg.version}-dev`;

export default defineConfig({
	define: {
		__APP_VERSION__: JSON.stringify(appVersion),
	},
	plugins: [tailwindcss(), sveltekit()],
	server: {
		port: 5173,
		host: '0.0.0.0',
		proxy: {
			'/api': {
				target: 'http://river-data-api:3000',
				changeOrigin: true,
			},
		},
	},
});
