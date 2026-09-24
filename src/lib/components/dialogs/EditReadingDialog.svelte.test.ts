import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EditOptionKind, InspectedRow } from '$api/service';

const inspectEdits = vi.fn();
const previewEdit = vi.fn();
const commitEdit = vi.fn();
const reloadToolRun = vi.fn();
const detachOutput = vi.fn();
const returnOutput = vi.fn();
const seasonalCheck = vi.fn();
const overrideOutput = vi.fn();
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
	seasonalCheck: (r: unknown) => seasonalCheck(r),
	overrideOutput: (b: unknown) => overrideOutput(b),
}));

const EditReadingDialog = (await import('./EditReadingDialog.svelte')).default;

function row(options: EditOptionKind[], hasToolRun = false, runId?: string): InspectedRow {
	return {
		stream_id: 'stream',
		time: '2026-07-14T09:00:00Z',
		replicate_index: 0,
		raw_value: 10,
		spot: false,
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
	seasonalCheck.mockReset();
	overrideOutput.mockReset();
});

describe('the edit dialog', () => {
	// Scenario: a stored grab value is corrected to a number outside the site's seasonal range.
	// Expected behaviour: the dialog screens the corrected value first, shows the warning, and
	// names that check in the decision it previews and commits (Q262).
	it('screens a grab correction and names its check on the preview and the commit', async () => {
		const grab = { ...row(['value_correction', 'flag']), spot: true };
		inspectEdits.mockResolvedValue({ rows: [grab] });
		seasonalCheck.mockResolvedValue({
			check_id: 'check-1',
			warnings: 1,
			findings: [
				{ parameter_id: 'param', value: 400, class: 'above_max', warning: true, n: 6, min: 8, q10: 9, q90: 12, max: 13, distribution: [] },
			],
		});
		previewEdit.mockResolvedValue({ preview_id: 'preview-1', rows: [], samples: [], calculations: [], not_previewed: [] });
		commitEdit.mockResolvedValue({ rows_decided: 1, decision_ids: [], set_id: 'set-1' });
		render(EditReadingDialog, { props: { open: true, selection } });

		await fireEvent.click(await screen.findByLabelText(/Correct the value/));
		await fireEvent.input(screen.getByLabelText('Corrected value'), { target: { value: '400' } });
		await waitFor(() => expect(previewEdit).toHaveBeenCalled());
		expect(seasonalCheck).toHaveBeenCalledWith({
			site_id: 'site',
			time: '2026-07-14T09:00:00Z',
			values: [{ parameter_id: 'param', value: 400 }],
		});
		expect(previewEdit.mock.calls.at(-1)?.[1]).toMatchObject({ value: 400, check_id: 'check-1' });
		expect(await screen.findByText(/above recorded maximum/)).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
		await waitFor(() => expect(commitEdit).toHaveBeenCalled());
		expect(commitEdit.mock.calls[0][1]).toMatchObject({ check_id: 'check-1' });
	});

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

	it('previews a typed corrected value', async () => {
		inspectEdits.mockResolvedValue({ rows: [row(['value_correction', 'flag'])] });
		previewEdit.mockResolvedValue({
			preview_id: 'preview-1',
			rows: [],
			samples: [],
			calculations: [],
			not_previewed: [],
		});
		render(EditReadingDialog, { open: true, selection });
		await fireEvent.click(await screen.findByLabelText(/Correct the value/));
		await fireEvent.input(screen.getByLabelText('Corrected value'), { target: { value: '40' } });
		await waitFor(() =>
			expect(previewEdit).toHaveBeenCalledWith(selection, {
				kind: 'value_correction',
				value: 40,
				reason: undefined,
			}),
		);
		expect(await screen.findByText('Nothing: the readings already stand this way.')).toBeTruthy();
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

	// Scenario: an administrator replaces one calculated value by hand, opened from the record's
	// Override action.
	// Expected behaviour: the dialog opens on the override, and the override route receives the
	// value and the replicate picked, never the edits preview.
	it('overrides a calculated value through its own route, opened on the override', async () => {
		const options: EditOptionKind[] = ['reopen_run', 'detach', 'override'];
		const second = { ...row(options, true, 'run-1'), replicate_index: 1, raw_value: 12 };
		inspectEdits.mockResolvedValue({ rows: [row(options, true, 'run-1'), second] });
		overrideOutput.mockResolvedValue({ rows_decided: 1, decision_ids: [], set_id: 'set' });
		render(EditReadingDialog, { open: true, selection, initial: 'override' });
		await fireEvent.change(await screen.findByLabelText('Replicate'), { target: { value: '1' } });
		await fireEvent.input(screen.getByLabelText('Value'), { target: { value: '340' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Override' }));
		await waitFor(() =>
			expect(overrideOutput).toHaveBeenCalledWith({
				site_id: 'site',
				parameter_id: 'param',
				time: '2026-07-14T09:00:00Z',
				replicate_index: 1,
				value: 340,
				reason: undefined,
			}),
		);
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
