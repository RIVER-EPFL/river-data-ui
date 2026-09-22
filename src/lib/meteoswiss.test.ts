import { describe, expect, it } from 'vitest';
import type { DataStream, ReprocessingJob } from '$api/crud';
import { feedStatus, latestBackfill, streamKey } from './meteoswiss';

const stream = (last: string | null) => ({ last_data_time: last }) as DataStream;
const job = (o: Partial<ReprocessingJob>) =>
	({
		trigger_type: 'meteoswiss_backfill',
		status: 'completed',
		created_at: '2026-09-22T08:00:00Z',
		params: {},
		...o
	}) as ReprocessingJob;

describe('a subscription reports what it is doing', () => {
	it('is flowing once a value has landed, whatever the backfill said', () => {
		expect(feedStatus(stream('2026-09-22T08:40:00Z'), job({ status: 'failed' }))).toEqual({
			kind: 'flowing',
			at: '2026-09-22T08:40:00Z'
		});
	});

	it('carries the backfill failure when nothing has landed', () => {
		expect(
			feedStatus(stream(null), job({ status: 'failed', error_message: 'MAR publishes no prestas0' }))
		).toEqual({ kind: 'failed', message: 'MAR publishes no prestas0' });
	});

	it('is working while the backfill is queued or running', () => {
		expect(feedStatus(stream(null), job({ status: 'queued' })).kind).toBe('working');
		expect(feedStatus(stream(null), job({ status: 'running' })).kind).toBe('working');
	});

	it('is empty with no stream, and with a completed backfill that landed nothing', () => {
		expect(feedStatus(null, null).kind).toBe('empty');
		expect(feedStatus(stream(null), job({ status: 'completed' })).kind).toBe('empty');
	});
});

describe('the backfill a subscription is waiting on', () => {
	it('is the newest run of that station and variable', () => {
		const jobs = [
			job({ id: 'old', params: { station: 'MOB', variable: 'prestas0' }, created_at: '2026-09-01T00:00:00Z' }),
			job({ id: 'new', params: { station: 'mob', variable: 'PRESTAS0' }, created_at: '2026-09-22T00:00:00Z' }),
			job({ id: 'other', params: { station: 'SIO', variable: 'prestas0' } })
		] as ReprocessingJob[];
		expect(latestBackfill(jobs, 'MOB', 'prestas0')?.id).toBe('new');
		expect(latestBackfill(jobs, 'PAY', 'prestas0')).toBeNull();
	});

	it('ignores a job of another kind carrying the same params', () => {
		const jobs = [
			job({ id: 'x', trigger_type: 'refresh_aggregates', params: { station: 'MOB', variable: 'prestas0' } })
		] as ReprocessingJob[];
		expect(latestBackfill(jobs, 'MOB', 'prestas0')).toBeNull();
	});
});

describe('the stream a subscription feeds', () => {
	it('is keyed the way the API registers it', () => {
		expect(streamKey(' mob ', ' PRESTAS0 ', 'site-1')).toBe('MOB:prestas0:site-1');
	});
});
