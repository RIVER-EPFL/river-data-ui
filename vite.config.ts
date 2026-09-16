import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';

// Baked into the bundle as `__APP_VERSION__`. CI passes BUILD_VERSION (git tag on prod, short SHA
// on dev); local/dev builds fall back to the package.json version with a `-dev` suffix.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
const appVersion = process.env.BUILD_VERSION || `${pkg.version}-dev`;

// Several checkouts of this repository are worked at once and each dev server takes the same
// default port, so a server has to say which tree it is serving. The browser suite refuses one
// that is not its own.
function checkoutIdentity(): Plugin {
	return {
		name: 'river-checkout-identity',
		apply: 'serve',
		// Before SvelteKit, whose SPA fallback would answer this with index.html.
		enforce: 'pre',
		configureServer(server) {
			const base = server.config.base.replace(/\/$/, '');
			server.middlewares.use(`${base}/__checkout`, (_request, response) => {
				response.setHeader('content-type', 'application/json');
				response.end(JSON.stringify({ root: server.config.root }));
			});
		},
	};
}

export default defineConfig({
	define: {
		__APP_VERSION__: JSON.stringify(appVersion),
	},
	plugins: [tailwindcss(), sveltekit(), checkoutIdentity()],
	server: {
		port: 5173,
		host: '0.0.0.0',
		proxy: {
			'/api': {
				// Inside compose the API is a service name; a host-side dev server overrides it.
				target: process.env.VITE_API_PROXY_TARGET || 'http://river-data-api:3000',
				changeOrigin: true,
			},
		},
	},
});
