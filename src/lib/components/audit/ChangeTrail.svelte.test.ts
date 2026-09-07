import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getChangeAudit = vi.fn();
vi.mock('$api/service', () => ({ getChangeAudit: (s: string) => getChangeAudit(s) }));

const ChangeTrail = (await import('./ChangeTrail.svelte')).default;

beforeEach(() => vi.clearAllMocks());

describe('ChangeTrail', () => {
	it('lists what changed, in the order the API returned', async () => {
		getChangeAudit.mockResolvedValue([
			{
				changed_at: '2026-08-02T11:00:00Z',
				changed_by: 'evan',
				change: 'site_parameter_update',
				old_value: { decimal_places: 2, updated_at: '2026-07-01T00:00:00Z' },
				new_value: { decimal_places: 4, updated_at: '2026-08-02T11:00:00Z' },
			},
		]);
		const { container } = render(ChangeTrail, { subject: 'site_parameter:s1' });
		await screen.findByText('site_parameter_update');
		expect(getChangeAudit).toHaveBeenCalledWith('site_parameter:s1');
		expect(screen.getByText('evan')).toBeTruthy();
		// The column that moved is named; the stamp that always moves is not.
		expect(container.textContent).toContain('decimal_places');
		expect(container.textContent).not.toContain('updated_at');
	});

	it('says so when nothing has been changed', async () => {
		getChangeAudit.mockResolvedValue([]);
		render(ChangeTrail, { subject: 'parameter_group:g1' });
		expect(
			await screen.findByText('Nothing has been changed here since the trail began.'),
		).toBeTruthy();
	});

	it('names the gap where no actor was recorded', async () => {
		getChangeAudit.mockResolvedValue([
			{
				changed_at: '2026-08-02T11:00:00Z',
				changed_by: null,
				change: 'member_insert',
				old_value: null,
				new_value: { group_id: 'g1' },
			},
		]);
		render(ChangeTrail, { subject: 'parameter_group:g1' });
		expect(await screen.findByText('actor not recorded')).toBeTruthy();
	});
});
