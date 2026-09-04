import { render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

const PATCH = vi.fn();
vi.mock('$api/client', () => ({ PATCH: (...args: unknown[]) => PATCH(...args) }));

const FlagDialog = (await import('./FlagDialog.svelte')).default;

const props = {
	open: true,
	mode: 'flag' as const,
	siteId: 'site-1',
	parameterId: 'param-1',
	parameterName: 'Depth',
	startMs: Date.UTC(2025, 5, 15, 10, 0),
	endMs: Date.UTC(2025, 5, 15, 12, 0),
};

describe('FlagDialog', () => {
	it('asks for the count with dry_run when it opens and renders it before the range', async () => {
		PATCH.mockResolvedValue({ updated: 3 });
		render(FlagDialog, props);
		await waitFor(() => expect(screen.getByTestId('flag-count').textContent).toContain('3'));
		expect(PATCH).toHaveBeenCalledWith(
			'/api/readings/flag_range',
			expect.objectContaining({ site_id: 'site-1', parameter_id: 'param-1', dry_run: true }),
		);
		const text = screen.getByTestId('flag-count').textContent?.replace(/\s+/g, ' ').trim();
		expect(text).toMatch(/^3 readings, .+ to .+$/);
	});

	it('names the aggregate consequence in one clause', async () => {
		PATCH.mockResolvedValue({ updated: 1 });
		render(FlagDialog, props);
		await waitFor(() => expect(screen.getByTestId('flag-count').textContent).toContain('1 reading,'));
		expect(screen.getByText(/leave the continuous aggregates/)).toBeTruthy();
	});

	it('counts only flagged rows for unflag', async () => {
		PATCH.mockResolvedValue({ updated: 0 });
		render(FlagDialog, { ...props, mode: 'unflag' });
		await waitFor(() => expect(screen.getByTestId('flag-count').textContent).toContain('0 flagged readings'));
		expect(PATCH).toHaveBeenCalledWith('/api/readings/unflag_range', expect.objectContaining({ dry_run: true }));
		expect((screen.getByText('Unflag') as HTMLButtonElement).disabled).toBe(true);
	});
});
