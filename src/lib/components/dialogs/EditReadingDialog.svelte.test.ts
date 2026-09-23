import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EditOptionKind, InspectedRow } from '$api/service';

const inspectEdits = vi.fn();
const previewEdit = vi.fn();
const commitEdit = vi.fn();
const reloadToolRun = vi.fn();
const detachOutput = vi.fn();
const returnOutput = vi.fn();
const goto = vi.fn();

vi.mock('$app/navigation', () => ({
	goto: (url: string) => goto(url),
}));

vi.mock('$api/service', () => ({
	inspectEdits: (s: unknown) => inspectEdits(s),
	previewEdit: (s: unknown, d: unknown) => previewEdit(s, d),
	commitEdit: (s: unknown, d: unknown, p: unknown) => commitEdit(s, d, p),
	reloadToolRun: (id: string) => reloadToolRun(id),
	detachOutput: (b: unknown) => detachOutput(b),
	returnOutput: (b: unknown) => returnOutput(b),
}));

const EditReadingDialog = (await import('./EditReadingDialog.svelte')).default;

function row(options: EditOptionKind[], hasToolRun = false, runId?: string): InspectedRow {
	return {
		stream_id: 'stream',
		time: '2026-07-14T09:00:00Z',
		replicate_index: 0,
		raw_value: 10,
		provenance: {
			has_tool_run: hasToolRun,
			slot_detached: false,
			classification: 'manual',
			has_standard_curve: false,
			has_calibration: false,
			has_deployment: false,
			is_flagged: false,
			withdrawn: false,
			unverified: false,
		},
		options,
		tool_run_id: runId,
		site_id: 'site',
		parameter_id: 'param',
	};
}

const selection = { keys: [{ stream_id: 'stream', time: '2026-07-14T09:00:00Z' }] };

beforeEach(() => {
	inspectEdits.mockReset();
	previewEdit.mockReset();
	commitEdit.mockReset();
	reloadToolRun.mockReset();
	goto.mockReset();
	detachOutput.mockReset();
	returnOutput.mockReset();
});

describe('the edit dialog', () => {
	it('offers the in-place correction for a value nothing computed', async () => {
		inspectEdits.mockResolvedValue({
			rows: [row(['value_correction', 'flag', 'withdraw'])],
		});
		render(EditReadingDialog, { props: { open: true, selection } });

		await waitFor(() => expect(screen.getByText('Correct the value')).toBeTruthy());
		expect(screen.getByText(/corrected here/)).toBeTruthy();
		// Every option says what it changes and what it leaves alone.
		expect(screen.getByText(/a correction corrects the measurement, not the correction/)).toBeTruthy();
	});

	it('sends a tool-produced value back to its calculation instead of offering a correction', async () => {
		inspectEdits.mockResolvedValue({ rows: [row(['reopen_run', 'flag'], true, 'run-1')] });
		render(EditReadingDialog, { props: { open: true, selection } });

		await waitFor(() => expect(screen.getByText('Reopen the calculation')).toBeTruthy());
		expect(screen.queryByText('Correct the value')).toBeNull();
		expect(screen.getByText(/corrected by reopening the run/)).toBeTruthy();
	});

	it('reopens the run through the app, which is served under a base path', async () => {
		inspectEdits.mockResolvedValue({ rows: [row(['reopen_run', 'flag'], true, 'run-1')] });
		reloadToolRun.mockResolvedValue({ tool: 'doc', inputs: {} });
		render(EditReadingDialog, { props: { open: true, selection } });

		await waitFor(() => expect(screen.getByText('Reopen the calculation')).toBeTruthy());
		await fireEvent.click(screen.getByRole('radio', { name: /Reopen the calculation/ }));
		await fireEvent.click(await screen.findByText('Open the calculation'));

		await waitFor(() => expect(goto).toHaveBeenCalled());
		expect(goto.mock.calls[0][0]).toBe('/admin/data-entry?tool=doc&reload=run-1');
	});

	it('offers only what every reading in a mixed selection allows, and says so', async () => {
		inspectEdits.mockResolvedValue({
			rows: [row(['reopen_run', 'flag'], true, 'run-1'), row(['value_correction', 'flag'])],
		});
		render(EditReadingDialog, { props: { open: true, selection } });

		await waitFor(() => expect(screen.getByText(/mixes calculated values/)).toBeTruthy());
		expect(screen.getByText('Flag')).toBeTruthy();
		expect(screen.queryByText('Correct the value')).toBeNull();
		expect(screen.queryByText('Reopen the calculation')).toBeNull();
	});

	// Scenario: an administrator takes a tool-run output away from its calculation.
	// Expected behaviour: the detach route is called for the row's slot and instant, with the
	// reason, and the edits preview is never asked about an ownership change it refuses.
	it('detaches through the detach route rather than previewing an edit', async () => {
		inspectEdits.mockResolvedValue({ rows: [row(['reopen_run', 'detach'], true, 'run-1')] });
		detachOutput.mockResolvedValue({ owner: 'manual', rows_decided: 1 });
		render(EditReadingDialog, { open: true, selection });
		await fireEvent.click(await screen.findByLabelText(/Detach from the calculation/));
		await fireEvent.input(screen.getByLabelText('Reason'), { target: { value: 'lab override' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Detach' }));
		await waitFor(() =>
			expect(detachOutput).toHaveBeenCalledWith({
				site_id: 'site',
				parameter_id: 'param',
				time: '2026-07-14T09:00:00Z',
				reason: 'lab override',
			}),
		);
		expect(previewEdit).not.toHaveBeenCalled();
	});

	it('returns a detached slot through the return route', async () => {
		const detached = row(['value_correction', 'return']);
		detached.provenance.slot_detached = true;
		inspectEdits.mockResolvedValue({ rows: [detached] });
		returnOutput.mockResolvedValue({ owner: 'tool', rows_decided: 1 });
		render(EditReadingDialog, { open: true, selection });
		await fireEvent.click(await screen.findByLabelText(/Return to the calculation/));
		await fireEvent.click(screen.getByRole('button', { name: 'Return' }));
		await waitFor(() => expect(returnOutput).toHaveBeenCalled());
		expect(previewEdit).not.toHaveBeenCalled();
	});

	it('says when nothing is stored at the selection', async () => {
		inspectEdits.mockResolvedValue({ rows: [] });
		render(EditReadingDialog, { props: { open: true, selection } });
		await waitFor(() => expect(screen.getByText(/Nothing is stored/)).toBeTruthy());
	});

	it('reports what the record could not be read', async () => {
		inspectEdits.mockRejectedValue(new Error('a selection names a stream, a slot, or keys'));
		render(EditReadingDialog, { props: { open: true, selection } });
		await waitFor(() =>
			expect(screen.getByText(/a selection names a stream, a slot, or keys/)).toBeTruthy(),
		);
	});
});
