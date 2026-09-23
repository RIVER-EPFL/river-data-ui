/** The url a notification click opens: its own, or the app root under `base`. */
export function clickTarget(url: string | undefined, base: string): string {
	return url ?? `${base}/`;
}

/** Whether an open window is a tab of this app, ie. its path lies under `base`. */
export function isAppClient(clientUrl: string, base: string): boolean {
	const path = new URL(clientUrl).pathname;
	return base === '' || path === base || path.startsWith(`${base}/`);
}
