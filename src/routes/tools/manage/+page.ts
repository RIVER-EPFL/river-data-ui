import { redirect } from '@sveltejs/kit';
import { base } from '$app/paths';

import { manageToolsRedirect } from '$lib/toolbox/redirect';

export function load({ url }) {
	redirect(308, manageToolsRedirect(base, url.searchParams));
}
