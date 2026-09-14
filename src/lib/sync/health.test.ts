import { describe, expect, it } from 'vitest';
import { serviceHealth } from './health';
import type { SyncEvent, SyncService } from '$api/service';

const NOW = Date.parse('2026-09-04T12:00:00Z');

function service(over: Partial<SyncService>): SyncService {
	// The spread of a `Partial` widens every key it might carry, so the merge is asserted rather
	// than inferred; the defaults below are the whole shape.
	return {
		id: 'svc',
		service_type: 'vaisala',
		instance_id: 'vaisala-1',
		status: 'idle',
		current_operation: null,
		paused: false,
		sync_interval_secs: null,
		full_reassert_enabled: false,
		last_heartbeat: '2026-09-04T11:59:30Z',
		last_sync_completed_at: null,
		last_error: null,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		...over,
	} as SyncService;
}

function event(status: string): SyncEvent {
	return { id: 'evt', service_id: 'svc', status } as SyncEvent;
}

describe('serviceHealth', () => {
	it('reads a fresh heartbeat and a clean cycle as ok', () => {
		expect(serviceHealth(service({}), event('completed'), NOW)).toBe('ok');
	});

	it('reads a late heartbeat as a warning', () => {
		// 11:57:00 is two minutes old: past 90 seconds, inside five minutes.
		expect(serviceHealth(service({ last_heartbeat: '2026-09-04T11:57:00Z' }), null, NOW)).toBe(
			'warning',
		);
	});

	it('reads a silent service as an alarm', () => {
		expect(serviceHealth(service({ last_heartbeat: '2026-09-04T11:50:00Z' }), null, NOW)).toBe(
			'alarm',
		);
	});

	it('reads a service that has never beaten as unknown', () => {
		expect(serviceHealth(service({ last_heartbeat: null }), null, NOW)).toBe('unknown');
	});

	it('alarms on a failed cycle behind a fresh heartbeat', () => {
		expect(serviceHealth(service({}), event('failed'), NOW)).toBe('alarm');
	});

	it('warns on a partial cycle behind a fresh heartbeat', () => {
		expect(serviceHealth(service({}), event('partial'), NOW)).toBe('warning');
	});

	it('keeps the alarm of a silent service whatever its last cycle said', () => {
		expect(
			serviceHealth(service({ last_heartbeat: '2026-09-04T11:50:00Z' }), event('completed'), NOW),
		).toBe('alarm');
	});

	it('takes the worse of a late heartbeat and a failed cycle', () => {
		expect(
			serviceHealth(service({ last_heartbeat: '2026-09-04T11:57:00Z' }), event('failed'), NOW),
		).toBe('alarm');
	});

	it('reads no cycle at all as the heartbeat alone', () => {
		expect(serviceHealth(service({}), undefined, NOW)).toBe('ok');
	});
});
