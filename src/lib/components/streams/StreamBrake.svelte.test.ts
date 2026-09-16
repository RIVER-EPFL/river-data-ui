import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listReplicateAudits = vi.fn();
vi.mock('$api/service', () => ({
	listReplicateAudits: (...args: unknown[]) => listReplicateAudits(...args),
	acknowledgeReplicateAudit: vi.fn(),
}));
vi.mock('$lib/stores/toast.svelte', () => ({ toastStore: { success: vi.fn(), error: vi.fn() } }));

const StreamBrake = (await import('./StreamBrake.svelte')).default;

const braked = {
	id: 'hold-1',
	kind: 'brake_fired',
	stream_id: 'stream-1',
	expected: {
		window: { from: '2025-01-01T00:00:00Z', to: '2025-02-01T00:00:00Z' },
		would_change: 40,
		would_withdraw: 3,
		stored_in_window: 120,
	},
};

describe('StreamBrake', () => {
	beforeEach(() => {
		listReplicateAudits.mockReset().mockResolvedValue({ holds: [braked], total: 1 });
	});

	it("reads the stream's pending brake and offers the release to a manager", async () => {
		render(StreamBrake, { streamId: 'stream-1', canRelease: true });
		expect(await screen.findByText(/would change 40 and withdraw 3 of 120/)).toBeTruthy();
		expect(screen.getByText('Release the brake').closest('button')).toBeTruthy();
		expect(listReplicateAudits).toHaveBeenCalledWith({
			stream_id: 'stream-1',
			kind: 'brake_fired',
			status: 'pending',
		});
	});

	it('shows the hold without the release to someone who cannot release it', async () => {
		render(StreamBrake, { streamId: 'stream-1', canRelease: false });
		expect(await screen.findByText(/would change 40/)).toBeTruthy();
		expect(screen.queryByText('Release the brake')).toBeNull();
	});

	it('shows nothing for a stream with no brake held', async () => {
		listReplicateAudits.mockResolvedValue({ holds: [], total: 0 });
		const { container } = render(StreamBrake, { streamId: 'stream-1', canRelease: true });
		await vi.waitFor(() => expect(listReplicateAudits).toHaveBeenCalled());
		expect(container.textContent?.trim()).toBe('');
	});
});
