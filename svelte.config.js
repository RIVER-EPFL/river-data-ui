import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			fallback: 'index.html',
		}),
		paths: {
			base: '/admin',
		},
		alias: {
			$components: 'src/lib/components',
			$api: 'src/lib/api',
			$auth: 'src/lib/auth',
			$schemas: 'src/lib/schemas',
		},
	},
};

export default config;
