import { ApiError } from '$api/client';
import type { Capability } from '$auth/me.svelte';

/// The capability the API enforces over calculation authoring: every write on `/tool_scripts`,
/// `/derived_parameters`, `/parameter_groups`, `/constants` and their members is
/// `Capability::Admin`. The UI gates on the same one, so the nav and the pages cannot offer what
/// the API refuses.
export const AUTHOR_CALCULATIONS: Capability = 'admin';

export const AUTHORING_REFUSED =
	'Authoring calculations requires the Administrator role.';

/// A constant feeds every formula that names it, so it is authored under the same role (Q173).
export const CONSTANTS_REFUSED =
	'Creating and editing constants requires the Administrator role.';

export type CatalogLoad<T> =
	| { status: 'loaded'; items: T[] }
	| { status: 'refused' }
	| { status: 'failed'; message: string };

/// Load an authoring catalog, keeping a refusal apart from an empty catalog: a 401 or 403 is the
/// API saying the caller may not author, and anything else is a load failure worth showing.
export async function loadCatalog<T>(
	load: () => Promise<T[]>,
	fallback = 'The calculation catalog could not be loaded.',
): Promise<CatalogLoad<T>> {
	try {
		return { status: 'loaded', items: await load() };
	} catch (e) {
		if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
			return { status: 'refused' };
		}
		return {
			status: 'failed',
			message: e instanceof Error ? e.message : fallback,
		};
	}
}

/// Whether the surface offers authoring, and what it says when it does not. The role and the
/// API's own refusal say the same thing, so a stale capability map still reads as a refusal.
export function authoringState(access: {
	permitted: boolean;
	refused: boolean;
}): { authorable: true } | { authorable: false; notice: string } {
	if (!access.permitted || access.refused)
		return { authorable: false, notice: AUTHORING_REFUSED };
	return { authorable: true };
}
