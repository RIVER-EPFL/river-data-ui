import type { SyncEvent, SyncService } from '$api/service';

export type ServiceHealth = 'ok' | 'warning' | 'alarm' | 'unknown';

// A heartbeat older than the first is late, older than the second means the service is gone.
const HEARTBEAT_OK_MS = 90_000;
const HEARTBEAT_LATE_MS = 300_000;

// A service that heartbeats on time while every stream in its source errors is not healthy, so the
// dot reads the service's most recent cycle as well as its heartbeat age.
export function serviceHealth(
	svc: SyncService,
	latest: SyncEvent | null | undefined,
	now = Date.now(),
): ServiceHealth {
	if (!svc.last_heartbeat) return 'unknown';
	const age = now - new Date(svc.last_heartbeat).getTime();
	const byAge = age < HEARTBEAT_OK_MS ? 'ok' : age < HEARTBEAT_LATE_MS ? 'warning' : 'alarm';
	if (byAge === 'alarm') return 'alarm';
	if (latest?.status === 'failed') return 'alarm';
	if (latest?.status === 'partial') return 'warning';
	return byAge;
}
