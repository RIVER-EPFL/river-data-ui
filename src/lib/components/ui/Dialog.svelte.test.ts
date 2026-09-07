import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import DialogHarness from './DialogHarness.test.svelte';

// The keyboard has to come back where it came from: a dialog opened from a cell the operator is
// typing in must not leave focus on the body when it closes (M119).
describe('Dialog focus', () => {
	it('takes focus to the first control inside when it opens', async () => {
		render(DialogHarness);
		await fireEvent.click(screen.getByTestId('opener'));
		await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('first')));
	});

	it('gives focus back to what opened it when it closes', async () => {
		render(DialogHarness);
		const opener = screen.getByTestId('opener');
		opener.focus();
		await fireEvent.click(opener);
		await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('first')));

		await fireEvent.click(screen.getByTestId('close'));
		await waitFor(() => expect(document.activeElement).toBe(opener));
	});

	it('gives focus back when it is closed with Escape', async () => {
		render(DialogHarness);
		const opener = screen.getByTestId('opener');
		opener.focus();
		await fireEvent.click(opener);
		await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('first')));

		await fireEvent.keyDown(window, { key: 'Escape' });
		await waitFor(() => expect(document.activeElement).toBe(opener));
	});

	it('keeps Tab inside the dialog rather than walking out into the page behind', async () => {
		render(DialogHarness);
		await fireEvent.click(screen.getByTestId('opener'));
		await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('first')));

		screen.getByTestId('close').focus();
		await fireEvent.keyDown(window, { key: 'Tab' });
		expect(document.activeElement).toBe(screen.getByTestId('first'));

		screen.getByTestId('first').focus();
		await fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
		expect(document.activeElement).toBe(screen.getByTestId('close'));
	});
});
