import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ConfirmButton from './ConfirmButton.svelte';

describe('ConfirmButton', () => {
	afterEach(() => vi.useRealTimers());

	const mount = (onconfirm = vi.fn()) => {
		render(ConfirmButton, {
			label: 'Discard',
			confirmLabel: 'Click again to discard',
			consequence: 'Its decisions are lost',
			onconfirm,
		});
		return onconfirm;
	};

	it('acts on the second press only, naming what it does in between', async () => {
		const onconfirm = mount();
		await fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
		expect(onconfirm).not.toHaveBeenCalled();
		const armed = screen.getByRole('button', { name: 'Click again to discard' });
		expect(armed.getAttribute('title')).toBe('Its decisions are lost');
		await fireEvent.click(armed);
		expect(onconfirm).toHaveBeenCalledTimes(1);
		expect(screen.getByRole('button', { name: 'Discard' })).toBeTruthy();
	});

	it('goes back to its label when left alone or when focus moves away', async () => {
		vi.useFakeTimers();
		const onconfirm = mount();
		await fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
		vi.advanceTimersByTime(4000);
		await vi.runAllTicks();
		await fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
		await fireEvent.blur(screen.getByRole('button', { name: 'Click again to discard' }));
		await fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
		expect(onconfirm).not.toHaveBeenCalled();
	});
});
