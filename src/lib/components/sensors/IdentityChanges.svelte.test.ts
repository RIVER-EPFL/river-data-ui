import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listReplicateAudits = vi.fn();
const listStreams = vi.fn();
vi.mock('$api/service', () => ({
	listReplicateAudits: (...args: unknown[]) => listReplicateAudits(...args),
	acceptIdentityChange: vi.fn(),
}));
vi.mock('$api/crud', () => ({
	api: { dataStreams: { list: (...args: unknown[]) => listStreams(...args) } },
}));
vi.mock('$lib/stores/toast.svelte', () => ({ toastStore: { success: vi.fn(), error: vi.fn() } }));

const IdentityChanges = (await import('./IdentityChanges.svelte')).default;

const changed = {
	id: 'hold-1',
	kind: 'source_identity_changed',
	stream_id: 'stream-1',
	source_key: 'cnet:sensor_params:DO',
	group_time: '2025-06-15T09:00:00Z',
	expected: { was: { serial_number: '1234' }, fields: ['serial_number'] },
	computed: { now: { serial_number: '5678' } },
};

describe('IdentityChanges', () => {
	beforeEach(() => {
		listStreams.mockReset().mockResolvedValue({ data: [{ id: 'stream-1' }, { id: 'stream-2' }], total: 2 });
		listReplicateAudits.mockReset().mockResolvedValue({ holds: [changed], total: 1 });
	});

	it("lists what each of the instrument's feeds reports differently", async () => {
		render(IdentityChanges, { sensorId: 'sensor-1', canAcknowledge: true });
		expect(await screen.findByText('5678')).toBeTruthy();
		expect(screen.getByText('1234')).toBeTruthy();
		expect(listStreams).toHaveBeenCalledWith(expect.objectContaining({ filter: { sensor_id: 'sensor-1' } }));
		expect(listReplicateAudits).toHaveBeenCalledWith({
			stream_ids: 'stream-1,stream-2',
			kind: 'source_identity_changed',
			status: 'pending',
		});
		expect(screen.getByText('Acknowledge').closest('button')).toBeTruthy();
	});

	it('asks nothing about an instrument with no feed', async () => {
		listStreams.mockResolvedValue({ data: [], total: 0 });
		const { container } = render(IdentityChanges, { sensorId: 'sensor-1', canAcknowledge: true });
		await vi.waitFor(() => expect(listStreams).toHaveBeenCalled());
		expect(listReplicateAudits).not.toHaveBeenCalled();
		expect(container.textContent?.trim()).toBe('');
	});
});
