import type { ProvenanceRecord } from '$api/service';

/** The Services tab narrowed to the sync services of a synced record's source system; null for anyone but an admin. */
export function originServiceHref(
	basePath: string,
	origin: Pick<ProvenanceRecord['origin'], 'classification' | 'source_system'>,
	admin: boolean,
): string | null {
	if (!admin || origin.classification !== 'sync') return null;
	const params = new URLSearchParams({ tab: 'services', service: origin.source_system });
	return `${basePath}/streams?${params}`;
}
