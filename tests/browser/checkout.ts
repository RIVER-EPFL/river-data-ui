/** What a dev server says about the checkout it is serving, from `GET /__checkout`. */
export interface Checkout {
	root: string;
}

/**
 * Why this run must not use the dev server at `url`, or null when it may.
 *
 * Playwright reuses whatever already holds the port, and several checkouts of this repository are
 * worked at once, so without this a story passes against code it never ran.
 */
export function foreignServerRefusal(
	url: string,
	root: string,
	reported: Checkout | null,
): string | null {
	if (reported === null) {
		return (
			`${url} does not say which checkout it serves. The browser suite needs a dev server ` +
			`from ${root}; free the port, or set E2E_PORT to one nothing is using.`
		);
	}
	if (reported.root !== root) {
		return (
			`${url} is serving ${reported.root}, not ${root}. Playwright reuses a dev server that ` +
			`already holds the port, so this run would exercise the other checkout. Stop that ` +
			`server, or set E2E_PORT to one nothing is using.`
		);
	}
	return null;
}
