import { render, waitFor } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { HotInstance } from 'handsontable';
import SheetGrid from './SheetGrid.svelte';

describe('SheetGrid', () => {
	it('mounts the grid over the rows it is given, under the free licence key', async () => {
		let hot: HotInstance | null = null;
		render(SheetGrid, { data: [[1.5, 2]], settings: {}, onready: (h: HotInstance) => (hot = h) });
		await waitFor(() => expect(hot).not.toBeNull());
		expect(hot!.getDataAtCell(0, 0)).toBe(1.5);
		expect(hot!.getSettings().licenseKey).toBe('non-commercial-and-evaluation');
	});

	it('loads new rows and settings without mounting a second grid', async () => {
		let mounts = 0;
		let hot: HotInstance | null = null;
		const view = render(SheetGrid, {
			data: [[1]],
			settings: { readOnly: false },
			onready: (h: HotInstance) => {
				mounts += 1;
				hot = h;
			},
		});
		await waitFor(() => expect(hot).not.toBeNull());
		await view.rerender({ data: [[7], [8]], settings: { readOnly: true } });
		await waitFor(() => expect(hot!.getDataAtCell(1, 0)).toBe(8));
		expect(hot!.getSettings().readOnly).toBe(true);
		expect(mounts).toBe(1);
	});

	it('destroys the grid when it unmounts', async () => {
		let hot: HotInstance | null = null;
		const view = render(SheetGrid, { data: [[1]], settings: {}, onready: (h: HotInstance) => (hot = h) });
		await waitFor(() => expect(hot).not.toBeNull());
		view.unmount();
		expect(hot!.isDestroyed).toBe(true);
	});

	// Scenario: a cell of the grid was clicked, and the person then types into a field outside it
	// whose every keystroke hands the grid new rows (B604). Expected behaviour: loading the rows
	// leaves the keyboard where the person put it.
	it('keeps the focus of a field outside the grid while new rows load', async () => {
		let hot: HotInstance | null = null;
		const field = document.createElement('input');
		document.body.append(field);
		const view = render(SheetGrid, {
			data: [[1], [2]],
			settings: { outsideClickDeselects: false },
			onready: (h: HotInstance) => (hot = h),
		});
		await waitFor(() => expect(hot).not.toBeNull());
		hot!.selectCell(0, 0);
		field.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		field.focus();
		expect(document.activeElement).toBe(field);
		expect(hot!.isListening()).toBe(false);

		await view.rerender({ data: [[1], [2], [3]], settings: { outsideClickDeselects: false } });
		await waitFor(() => expect(hot!.getDataAtCell(2, 0)).toBe(3));
		expect(document.activeElement).toBe(field);
		expect(hot!.isListening()).toBe(false);
		field.remove();
	});

	// Scenario: a cell of the grid is selected and a dropdown outside it is changed without taking
	// the focus, as an automation or assistive tool sets a value (B709). Expected behaviour: the
	// grid stops taking keys, so what is typed next does not open its editor on the selected cell.
	it('stops taking keys when a field outside the grid is changed', async () => {
		let hot: HotInstance | null = null;
		const select = document.createElement('select');
		select.append(new Option('none', ''), new Option('lab_a', 'lab_a'));
		document.body.append(select);
		render(SheetGrid, {
			data: [['CO2_HS_Um']],
			settings: { outsideClickDeselects: false },
			onready: (h: HotInstance) => (hot = h),
		});
		await waitFor(() => expect(hot).not.toBeNull());
		hot!.selectCell(0, 0);
		hot!.listen();
		expect(hot!.isListening()).toBe(true);

		select.value = 'lab_a';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		expect(hot!.isListening()).toBe(false);
		select.remove();
	});
});
