import { redirect } from '@sveltejs/kit';
import { base } from '$app/paths';

import { dataEntryHref } from '$lib/dataEntry/entry';

export function load({ url }) {
	redirect(308, dataEntryHref(base, url.search));
}
