import type { SyncService } from '$api/service';

// A service is reachable when it has beaten within the command pickup window; a command queued for
// a silent one sits pending until it comes back.
const HEARTBEAT_WINDOW_MS = 300_000;

export function serviceReachable(svc: SyncService, now = Date.now()): boolean {
	if (!svc.last_heartbeat) return false;
	return now - new Date(svc.last_heartbeat).getTime() < HEARTBEAT_WINDOW_MS;
}

// The reachable service feeding a source system. Internal channels ('api', 'grab_sample') have no
// service and so no repair.
export function resyncServiceFor(
	services: SyncService[],
	sourceSystem: string,
	now = Date.now(),
): SyncService | null {
	return (
		services.find((s) => s.service_type === sourceSystem && serviceReachable(s, now)) ?? null
	);
}

// What a full sync actually does, which is not the same on both kinds of source: a portal declares
// the window it re-asserts, so its diff applies corrections; an append-only source is only asked
// for history again and the rows already stored are left alone.
export const FULL_SYNC_CONFIRMATION =
	'Re-read this source from the start of its history. ' +
	'Rows missing here are added. Values already stored are corrected only where the source ' +
	'declares the window it re-asserts (the portal syncs); on an append-only source (Vaisala, ' +
	'NOMIS) they stay as they are. To correct stored values, use Repair stored values.';

// Named for what it rewrites, since it is the one command that moves a value a person may be
// reading. The three things it leaves alone are the three a person put there.
export function resyncConfirmation(streamCount: number, instanceId: string): string {
	const streams = streamCount === 1 ? '1 stream' : `${streamCount} streams`;
	return (
		`Re-fetch ${streams} from ${instanceId} from the start of history and overwrite what is ` +
		'stored. Values and their attribution are rewritten from the source; flags, hand-picked ' +
		'curves and sample links are left alone. There is no undo.'
	);
}
