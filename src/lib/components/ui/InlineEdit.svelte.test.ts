import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

import InlineEdit from './InlineEdit.svelte';

describe('InlineEdit', () => {
	it('saves when the field loses focus', async () => {
		const onsave = vi.fn(async () => {});
		render(InlineEdit, { value: 'pCO2', label: 'Label', onsave });
		await fireEvent.click(screen.getByRole('button', { name: 'Edit label' }));
		const input = screen.getByRole('textbox', { name: 'Label' });
		await fireEvent.input(input, { target: { value: 'pCO2 headspace' } });
		await fireEvent.blur(input);
		await waitFor(() => expect(onsave).toHaveBeenCalledWith('pCO2 headspace'));
		expect(screen.queryByRole('textbox')).toBeNull();
	});

	it('puts the value back on Escape', async () => {
		const onsave = vi.fn(async () => {});
		render(InlineEdit, { value: 'pCO2', label: 'Label', onsave });
		await fireEvent.click(screen.getByRole('button', { name: 'Edit label' }));
		const input = screen.getByRole('textbox', { name: 'Label' });
		await fireEvent.input(input, { target: { value: 'changed' } });
		await fireEvent.keyDown(input, { key: 'Escape' });
		expect(screen.queryByRole('textbox')).toBeNull();
		expect(onsave).not.toHaveBeenCalled();
	});

	it('keeps a required value from being emptied', async () => {
		const onsave = vi.fn(async () => {});
		render(InlineEdit, { value: 'pCO2', label: 'Label', required: true, onsave });
		await fireEvent.click(screen.getByRole('button', { name: 'Edit label' }));
		const input = screen.getByRole('textbox', { name: 'Label' });
		await fireEvent.input(input, { target: { value: '  ' } });
		await fireEvent.blur(input);
		expect(onsave).not.toHaveBeenCalled();
	});
});
