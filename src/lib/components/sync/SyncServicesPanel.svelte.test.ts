import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getList = vi.fn();
const createServiceCredential = vi.fn();

vi.mock('$app/state', () => ({
	page: { url: new URL('https://river.test/streams?tab=services&service=cnet') },
}));

vi.mock('$api/client', () => ({
	getList: (path: string, options: unknown) => getList(path, options),
}));

vi.mock('$api/crud', () => ({
	api: { dataStreams: { list: vi.fn() } },
}));

vi.mock('$api/service', () => ({
	createServiceCredential: (serviceType: string) => createServiceCredential(serviceType),
	getSyncCommand: vi.fn(),
	issueSyncCommand: vi.fn(),
	revokeSyncService: vi.fn(),
	setFullReassert: vi.fn(),
	setSyncInterval: vi.fn(),
}));

const SyncServicesPanel = (await import('./SyncServicesPanel.svelte')).default;

const service = {
	id: 'service-1',
	instance_id: 'cnet-one',
	service_type: 'cnet',
	status: 'idle',
	paused: false,
	sync_interval_secs: null,
	full_reassert_enabled: false,
	last_heartbeat: null,
	last_sync_completed_at: null,
	last_error: null,
	current_operation: null,
};

const connectedCredential = {
	id: 'credential-1',
	client_id: 'connected-client',
	service_id: 'service-1',
	service_type: 'cnet',
	revoked: false,
	created_at: '2026-09-17T10:00:00Z',
};

const pendingCredential = {
	...connectedCredential,
	id: 'credential-2',
	client_id: 'pending-client',
	service_id: null,
};

beforeEach(() => {
	vi.clearAllMocks();
	getList.mockImplementation((path: string) => {
		if (path === '/api/sync_services') return Promise.resolve({ data: [service] });
		if (path === '/api/sync_service_credentials') {
			return Promise.resolve({ data: [connectedCredential, pendingCredential] });
		}
		return Promise.resolve({ data: [] });
	});
});

describe('SyncServicesPanel', () => {
	it('shows connected and awaiting service credentials with their controls', async () => {
		render(SyncServicesPanel);

		await screen.findByText('cnet-one');
		expect(screen.getByText('connected-client')).toBeTruthy();
		expect(screen.getByText('pending-client')).toBeTruthy();
		expect(screen.getAllByRole('button', { name: 'Pause' }).length).toBeGreaterThan(0);
		expect(screen.getByRole('button', { name: 'Connect service' })).toBeTruthy();
	});

	it('keeps the created secret in the copy-once connection flow', async () => {
		createServiceCredential.mockResolvedValue({
			client_id: 'new-client',
			client_secret: 'one-time-secret',
		});
		render(SyncServicesPanel);
		await screen.findByText('cnet-one');

		await fireEvent.click(screen.getByRole('button', { name: 'Connect service' }));
		await fireEvent.input(screen.getByLabelText('Service type'), { target: { value: 'vaisala' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Create credential' }));

		await waitFor(() => expect(createServiceCredential).toHaveBeenCalledWith('vaisala'));
		expect(screen.getByText('one-time-secret')).toBeTruthy();
		expect(screen.getByText('Copy the secret now. It will not be shown again.')).toBeTruthy();
	});
});
