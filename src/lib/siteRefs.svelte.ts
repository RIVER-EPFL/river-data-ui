import { api, type Site } from '$api/crud';
import { listAll } from '$api/paged';

/**
 * The site catalog, read once for the whole session. Every picker, name lookup and filter that
 * needs "all the sites" reads it here rather than paging `/sites` itself, so a page carrying
 * several of them makes one request.
 *
 * A site is created and renamed rarely and never by the pages that read this, so the list is
 * refreshed only on request.
 */

let sites = $state<Site[]>([]);
let inflight: Promise<Site[]> | null = null;

export const siteRefs = {
	get all(): Site[] {
		return sites;
	},

	/** Fetch once. Idempotent, safe to call from an effect. */
	ensure(): Promise<Site[]> {
		if (!inflight) {
			inflight = listAll(api.sites, { perPage: 500, sort: ['name', 'ASC'] })
				.then((rows) => {
					sites = rows;
					return rows;
				})
				.catch((e) => {
					inflight = null;
					throw e;
				});
		}
		return inflight;
	},

	/** Re-read after a site is created, renamed or moved. */
	refresh(): Promise<Site[]> {
		inflight = null;
		return this.ensure();
	},

	name(id: string | null | undefined): string {
		if (!id) return '';
		return sites.find((s) => s.id === id)?.name ?? id;
	},
};
