import { redirect } from '@sveltejs/kit';
import { base } from '$app/paths';

export function load({ params, url }) {
	redirect(308, `${base}/toolbox/${params.id}${url.search}`);
}
