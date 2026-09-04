import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getNotificationDeliveries = vi.fn();
vi.mock('$api/service', () => ({
	getNotificationDeliveries: (p: unknown) => getNotificationDeliveries(p),
}));

const DeliveryLogPanel = (await import('./DeliveryLogPanel.svelte')).default;

const alarm = {
	alarmEventId: 'event-1',
	kind: 'alarm_opened',
	at: '2026-09-01T10:00:00Z',
	siteName: 'Upstream Station',
	parameterName: 'Turbidity',
	counts: { total: 5, sent: 2, failed: 3, muted: 0, undeliverable: 0, skipped: 0 },
	recipients: [
		{ channel: 'web_push', recipient: 'device-a', status: 'sent', error: null, createdAt: '2026-09-01T10:00:00Z' },
		{ channel: 'web_push', recipient: 'device-b', status: 'failed', error: '410 gone', createdAt: '2026-09-01T10:00:00Z' },
	],
};

// A muted slot writes its row on the 'all' channel, which the old web_push-only listing hid.
const muted = {
	alarmEventId: null,
	kind: 'stale_data',
	at: '2026-09-01T11:00:00Z',
	siteName: null,
	parameterName: null,
	counts: { total: 1, sent: 0, failed: 0, muted: 1, undeliverable: 0, skipped: 0 },
	recipients: [
		{ channel: 'all', recipient: 'slot:s:p', status: 'muted', error: null, createdAt: '2026-09-01T11:00:00Z' },
	],
};

function open(messages = [muted, alarm], total = 2) {
	getNotificationDeliveries.mockResolvedValue({ messages, total });
	return render(DeliveryLogPanel, {});
}

beforeEach(() => vi.clearAllMocks());

describe('DeliveryLogPanel', () => {
	it('lists one row per message with what it reached and what it did not', async () => {
		open();
		const row = (await screen.findByRole('cell', { name: 'alarm_opened' })).closest('tr')!;
		expect(within(row).getByText('Upstream Station · Turbidity')).toBeTruthy();
		expect(within(row).getByText('2 sent')).toBeTruthy();
		expect(within(row).getByText('3 failed')).toBeTruthy();
	});

	it('shows the recipients and their errors when a message is expanded', async () => {
		open();
		const row = (await screen.findByRole('cell', { name: 'alarm_opened' })).closest('tr')!;
		expect(screen.queryByText('device-b')).toBeNull();
		await userEvent.click(within(row).getByRole('button', { name: /recipients/i }));
		expect(await screen.findByText('device-b')).toBeTruthy();
		expect(screen.getByText('410 gone')).toBeTruthy();
	});

	it('keeps a suppressed message, which reaches nobody and carries no web_push row', async () => {
		open();
		const row = (await screen.findByRole('cell', { name: 'stale_data' })).closest('tr')!;
		expect(within(row).getByText('1 muted')).toBeTruthy();
	});

	it('asks the API for the statuses that reached nobody when that filter is chosen', async () => {
		open();
		await screen.findByRole('cell', { name: 'alarm_opened' });
		await userEvent.selectOptions(screen.getByLabelText('Status'), 'undeliverable');
		expect(getNotificationDeliveries).toHaveBeenLastCalledWith(
			expect.objectContaining({ status: 'undeliverable', offset: 0 }),
		);
	});

	it('says the log is empty rather than showing a bare table', async () => {
		open([], 0);
		expect(await screen.findByText(/No deliveries/)).toBeTruthy();
	});
});
