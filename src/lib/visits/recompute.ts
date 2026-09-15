// A visit's recompute state as the API reports it, and how a page shows it. The chain runs as a
// tracked job, so a visit whose inputs have just been written says `queued` or `running` until its
// outputs are in the store.

export type RecomputeState = 'current' | 'queued' | 'running' | 'failed' | 'stale';

export type RecomputeBadge = { label: string; variant: 'muted' | 'accent' | 'alarm' | 'warning' };

/** The badge a state shows, or nothing at all for a visit whose calculations are done. */
export const RECOMPUTE_BADGE: Record<string, RecomputeBadge> = {
	queued: { label: 'queued', variant: 'muted' },
	running: { label: 'recomputing', variant: 'accent' },
	failed: { label: 'recompute failed', variant: 'alarm' },
	stale: { label: 'stale', variant: 'warning' },
};

/** Whether the visit's outputs are still being written, so what it reports is not yet its answer. */
export function computing(state: string | undefined): boolean {
	return state === 'queued' || state === 'running';
}

/**
 * The badge a visit carries for its calculations. A portal-synced visit runs none (Q41): its
 * values are the portal's answer and a correction entered here moves no output, so it reads as
 * not calculated rather than as up to date.
 */
export function visitBadge(
	source: string | undefined,
	state: string | undefined
): RecomputeBadge | null {
	if (source === 'portal_sync') return { label: 'not calculated here', variant: 'muted' };
	return RECOMPUTE_BADGE[state ?? ''] ?? null;
}

/** What a person entering a value at a portal-synced visit needs to know before they type it. */
export const SYNCED_VISIT_NOTICE =
	'Calculations do not run at a portal-synced visit: correct the value in the portal.';
