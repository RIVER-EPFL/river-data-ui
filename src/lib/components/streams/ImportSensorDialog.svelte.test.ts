import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const importStream = vi.fn();
vi.mock('$api/service', () => ({ importStream: (id: string) => importStream(id) }));
vi.mock('$lib/stores/toast.svelte', () => ({
	toastStore: { success: vi.fn(), error: vi.fn() },
}));

const ImportSensorDialog = (await import('./ImportSensorDialog.svelte')).default;

const stream = { id: 'stream-1', source_key: 'FP15:DOC_avg_ppb' } as never;

describe('ImportSensorDialog', () => {
	beforeEach(() => {
		importStream.mockReset();
		importStream.mockResolvedValue({ attributed: 6 });
	});

	it('imports with nothing chosen: the sensor carries no parameter of its own', async () => {
		render(ImportSensorDialog, { open: true, stream });

		const button = screen.getByRole('button', { name: 'Import' });
		expect((button as HTMLButtonElement).disabled).toBe(false);
		expect(screen.queryByRole('combobox')).toBeNull();

		button.click();
		await vi.waitFor(() => expect(importStream).toHaveBeenCalledTimes(1));
		expect(importStream).toHaveBeenCalledWith('stream-1');
	});

	it('names the stream it will import', () => {
		render(ImportSensorDialog, { open: true, stream });
		expect(screen.getByText('FP15:DOC_avg_ppb')).toBeTruthy();
	});
});
