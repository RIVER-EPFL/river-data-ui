import { getMySites, type NavigatorProject } from '$api/service';
import { auth } from '$auth/keycloak.svelte';

// The caller's visible sites (project → subproject → site), fetched once from `/api/me/sites` for
// the sidebar site navigator. Grant scoping happens server-side, so the tree is exactly what the
// user may see. In local no-auth mode the endpoint is Keycloak-only and not callable; the store
// stays empty and the navigator simply doesn't render.

type SitesState =
	| { status: 'loading' }
	| { status: 'ready'; tree: NavigatorProject[] }
	| { status: 'error' };

let state = $state<SitesState>({ status: 'loading' });
let started = false;

export const siteNavigator = {
	get status() {
		return state.status;
	},
	get tree(): NavigatorProject[] {
		return state.status === 'ready' ? state.tree : [];
	},

	/** Fetch once when authenticated. Idempotent, safe to call from an effect. */
	async ensure() {
		if (started) return;
		if (auth.state.status !== 'authenticated') return;
		started = true;
		try {
			state = { status: 'ready', tree: await getMySites() };
		} catch {
			state = { status: 'error' };
		}
	},

	/** Re-fetch after sites/grants change (not wired anywhere yet — sites rarely change). */
	async refresh() {
		started = false;
		state = { status: 'loading' };
		await this.ensure();
	},
};
