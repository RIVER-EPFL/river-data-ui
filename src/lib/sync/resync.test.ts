import { describe, expect, it } from 'vitest';
import { resyncConfirmation, resyncServiceFor, serviceReachable } from './resync';
import type { SyncService } from '$api/service';

const NOW = Date.parse('2026-09-04T12:00:00Z');

function service(over: Partial<SyncService>): SyncService {
	return {
		id: 'svc',
		service_type: 'vaisala',
		instance_id: 'vaisala-1',
		status: 'idle',
		current_operation: null,
		paused: false,
		sync_interval_secs: null,
		full_reassert_enabled: false,
		last_heartbeat: '2026-09-04T11:59:00Z',
		last_sync_completed_at: null,
		last_error: null,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		...over,
	};
}

describe('serviceReachable', () => {
	it('accepts a service that beat inside the window', () => {
		expect(serviceReachable(service({}), NOW)).toBe(true);
	});

	it('rejects a service that went silent', () => {
		expect(serviceReachable(service({ last_heartbeat: '2026-09-04T11:50:00Z' }), NOW)).toBe(false);
	});

	it('rejects a service that has never beaten', () => {
		expect(serviceReachable(service({ last_heartbeat: null }), NOW)).toBe(false);
	});
});

describe('resyncServiceFor', () => {
	it('finds the reachable service feeding a source system', () => {
		const svc = service({ service_type: 'cnet', instance_id: 'cnet-1' });
		expect(resyncServiceFor([service({}), svc], 'cnet', NOW)).toBe(svc);
	});

	it('offers nothing for an internal channel no service feeds', () => {
		expect(resyncServiceFor([service({})], 'grab_sample', NOW)).toBeNull();
	});

	it('offers nothing when the only matching service is silent', () => {
		const stale = service({ service_type: 'cnet', last_heartbeat: '2026-09-04T10:00:00Z' });
		expect(resyncServiceFor([stale], 'cnet', NOW)).toBeNull();
	});

	it('offers nothing when no service is registered at all', () => {
		expect(resyncServiceFor([], 'vaisala', NOW)).toBeNull();
	});
});

describe('resyncConfirmation', () => {
	it('counts one stream in the singular', () => {
		expect(resyncConfirmation(1, 'vaisala-1')).toContain('Re-fetch 1 stream from vaisala-1');
	});

	it('counts several in the plural', () => {
		expect(resyncConfirmation(22, 'vaisala-1')).toContain('Re-fetch 22 streams');
	});

	it('says what it rewrites and what it leaves alone', () => {
		const message = resyncConfirmation(3, 'cnet-1');
		expect(message).toContain('overwrite what is stored');
		expect(message).toContain('attribution');
		expect(message).toContain('flags, hand-picked curves and sample links are left alone');
		expect(message).toContain('no undo');
	});
});
