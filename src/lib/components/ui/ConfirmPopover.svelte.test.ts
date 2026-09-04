import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import ConfirmPopoverHarness from './ConfirmPopoverHarness.test.svelte';

describe('ConfirmPopover', () => {
	it('renders the detail snippet as labelled counts under the question', async () => {
		render(ConfirmPopoverHarness, {
			message: 'Declare the formula?',
			rows: [
				{ label: 'Samples recomputed', value: 12 },
				{ label: 'Holds remaining', value: 3 },
			],
		});
		await fireEvent.click(screen.getByText('Trigger'));
		expect(screen.getByText('Declare the formula?')).toBeTruthy();
		const list = screen.getByText('Samples recomputed').closest('dl');
		expect(list).toBeTruthy();
		expect(list?.querySelectorAll('dt').length).toBe(2);
		expect(screen.getByText('12').tagName).toBe('DD');
		expect(screen.getByText('3').tagName).toBe('DD');
	});

	it('bounds the panel width', async () => {
		render(ConfirmPopoverHarness, { message: 'Proceed?' });
		await fireEvent.click(screen.getByText('Trigger'));
		const panel = screen.getByText('Proceed?').parentElement;
		expect(panel?.className).toContain('max-w-');
	});
});
