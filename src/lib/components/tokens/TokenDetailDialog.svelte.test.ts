import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { base } from '$app/paths';
import type { ApiToken } from '$api/crud';

vi.mock('$api/crud', () => ({
	api: { apiTokenAuditLogs: { list: async () => ({ data: [], total: 0 }) } },
}));

const TokenDetailDialog = (await import('./TokenDetailDialog.svelte')).default;

const token: ApiToken = {
	id: 'tok-1',
	name: 'Partner feed',
	permissions: { read_metadata: true, read_data: true, write_metadata: false, write_data: false },
	expires_at: null,
	created_at: '2026-09-01T08:00:00Z',
};

describe('token detail dialog', () => {
	it('links View all logs to the System page Logs tab filtered to this token', async () => {
		render(TokenDetailDialog, { open: true, token, projectName: () => 'All projects' });
		const link = await screen.findByRole('link', { name: /View all logs/ });
		expect(link.getAttribute('href')).toBe(`${base}/system?tab=logs&token=tok-1`);
	});
});
