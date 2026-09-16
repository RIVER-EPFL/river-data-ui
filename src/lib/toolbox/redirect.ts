import { toolboxHref } from './route';

/// Where a link to the retired `/tools/manage` page lands: the named script's page, or the Toolbox
/// when it named none.
export function manageToolsRedirect(base: string, search: URLSearchParams): string {
	const script = search.get('script');
	if (!script) return `${base}/toolbox`;
	const version = Number(search.get('version'));
	return toolboxHref(base, script, Number.isInteger(version) && version > 0 ? version : null);
}
