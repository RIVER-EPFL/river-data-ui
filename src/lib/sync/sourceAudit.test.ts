import { describe, expect, it } from 'vitest';

import { latestSourceAudit, pairingPlanHref, unpairedStreamsHref } from './sourceAudit';

describe('source audit links', () => {
	it('opens the plan wizard on the audited source', () => {
		expect(pairingPlanHref('', 'cnet')).toBe('/streams?step=source-select&source=cnet');
	});

	it('opens the streams list held to that source and its unpaired rows', () => {
		expect(unpairedStreamsHref('', 'cnet')).toBe('/streams?list_filter=unpaired&source=cnet');
	});

	it('keeps the deployment base path in front of both', () => {
		expect(pairingPlanHref('/river', 'metalp')).toBe(
			'/river/streams?step=source-select&source=metalp',
		);
		expect(unpairedStreamsHref('/river', 'metalp')).toBe(
			'/river/streams?list_filter=unpaired&source=metalp',
		);
	});

	it('escapes a source system that is not a bare word', () => {
		expect(unpairedStreamsHref('', 'grab sample')).toBe(
			'/streams?list_filter=unpaired&source=grab+sample',
		);
	});
});

describe('the last report a service answered with', () => {
	const command = (
		id: string,
		service_id: string,
		cmd: string,
		status: string,
		completed_at: string | null,
		result: Record<string, unknown> | null,
	) => ({ id, service_id, command: cmd, status, completed_at, result });

	const commands = [
		command('1', 'svc-a', 'source_audit', 'completed', '2026-09-02T10:00:00Z', { columns: 2 }),
		command('2', 'svc-a', 'source_audit', 'completed', '2026-09-04T10:00:00Z', { columns: 7 }),
		command('3', 'svc-a', 'source_audit', 'pending', null, null),
		command('4', 'svc-a', 'trigger_sync', 'completed', '2026-09-09T10:00:00Z', { rows: 1 }),
		command('5', 'svc-b', 'source_audit', 'completed', '2026-09-09T10:00:00Z', { columns: 1 }),
	];

	it('is the newest completed audit that service answered', () => {
		const last = latestSourceAudit(commands, 'svc-a');
		expect(last?.report).toEqual({ columns: 7 });
		expect(last?.answeredAt).toBe('2026-09-04T10:00:00Z');
	});

	it('is nothing when the service has never answered one', () => {
		expect(latestSourceAudit(commands, 'svc-c')).toBeNull();
		expect(
			latestSourceAudit([command('6', 'svc-c', 'source_audit', 'pending', null, null)], 'svc-c'),
		).toBeNull();
	});
});
