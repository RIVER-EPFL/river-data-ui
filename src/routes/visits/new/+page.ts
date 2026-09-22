import { redirect } from '@sveltejs/kit';
import { base } from '$app/paths';

// A field day is pasted into the spare rows of the site's Visits grid, which stages the visits the
// block names. This route stands only so an old link lands on the visits it was pasting into.
export function load() {
	redirect(308, `${base}/events`);
}
