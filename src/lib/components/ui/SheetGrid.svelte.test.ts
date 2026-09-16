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
});
