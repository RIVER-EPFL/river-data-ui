import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import RowMenuHarness from './RowMenuHarness.test.svelte';

describe('RowMenu', () => {
	it('opens on its button, runs an item and closes', async () => {
		const onpick = vi.fn();
		render(RowMenuHarness, { onpick });
		expect(screen.queryByRole('menu')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Actions for DO' }));
		expect(screen.getByRole('menu').className).toContain('fixed');
		await fireEvent.click(screen.getByText('Merge…'));
		expect(onpick).toHaveBeenCalledOnce();
		expect(screen.queryByRole('menu')).toBeNull();
	});

	it('closes on Escape and on a press outside it', async () => {
		render(RowMenuHarness, { onpick: () => {} });
		const button = screen.getByRole('button', { name: 'Actions for DO' });
		await fireEvent.click(button);
		await fireEvent.keyDown(document, { key: 'Escape' });
		expect(screen.queryByRole('menu')).toBeNull();
		await fireEvent.click(button);
		await fireEvent.mouseDown(document.body);
		expect(screen.queryByRole('menu')).toBeNull();
	});
});
