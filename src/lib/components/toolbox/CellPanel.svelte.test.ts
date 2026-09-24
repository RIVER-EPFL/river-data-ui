import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import CellPanel from './CellPanel.svelte';
import { blankFormula, inputRows, type EditableFormula } from '$lib/calculations/editor';
import { sheetBlocks, type SheetRow } from '$lib/calculations/sheet';
import type { Parameter } from '$api/crud';

const formula = (over: Partial<EditableFormula>): EditableFormula => ({
	...blankFormula([]),
	...over,
});

const formulas: EditableFormula[] = [
	formula({
		code: 'hs_k',
		formula: 'exp(lab_temp / 100)',
		intermediate: true,
		ordinal: 1,
	}),
	formula({
		code: 'CO2_HS_Um',
		name: 'CO2 headspace',
		formula: 'lab_co2 * hs_k',
		ordinal: 2,
	}),
];
const parameters = [
	{
		code: 'lab_co2',
		name: 'Lab CO2',
		default_units: 'ppm',
		category: 'measurement',
	},
	{
		code: 'lab_temp',
		name: 'Lab temperature',
		default_units: 'degC',
		category: 'measurement',
	},
] as Parameter[];
const variables = parameters.map((p) => ({
	name: p.code,
	label: p.name,
	category: p.category,
}));

const blocks = sheetBlocks(formulas, inputRows(formulas, parameters, []));
const rowFor = (key: string): SheetRow => blocks.flatMap((b) => b.rows).find((r) => r.key === key)!;

describe('CellPanel', () => {
	it('opens on nothing until a cell is chosen', () => {
		render(CellPanel, { formulas, variables });
		expect(screen.getByRole('heading', { name: 'No cell selected' })).toBeTruthy();
	});

	it('edits the selected formula and names what it reads and what reads it', async () => {
		const onselect = vi.fn();
		render(CellPanel, {
			row: rowFor('hs_k'),
			formula: formulas[0],
			formulas,
			variables,
			onselect,
		});
		expect((screen.getByLabelText('Code') as HTMLInputElement).value).toBe('hs_k');
		await userEvent.click(screen.getByRole('button', { name: 'CO2_HS_Um' }));
		expect(onselect).toHaveBeenCalledWith('CO2_HS_Um');
	});

	it('edits a shared step in place, with what it feeds and a way to stop reading it', () => {
		const shared = formula({ ...formulas[0], declarationId: 'decl-1', shared: true });
		render(CellPanel, {
			row: rowFor('hs_k'),
			formula: shared,
			formulas,
			variables,
		});
		expect((screen.getByLabelText('Code') as HTMLInputElement).value).toBe('hs_k');
		expect(screen.getByLabelText('Units')).toBeTruthy();
		expect(screen.getByText(/every calculation that declares it/)).toBeTruthy();
		expect(screen.getByRole('button', { name: 'What it feeds' })).toBeTruthy();
		expect(screen.getAllByRole('button', { name: 'Stop reading' }).length).toBeGreaterThan(0);
	});

	it('offers a step to every calculation that declares it', async () => {
		const step = $state(formula({ ...formulas[0] }));
		render(CellPanel, { row: rowFor('hs_k'), formula: step, formulas, variables });
		const whose = screen.getByLabelText(/^Read by/) as HTMLSelectElement;
		expect(whose.value).toBe('false');
		await userEvent.selectOptions(whose, 'true');
		expect(step.shared).toBe(true);
	});

	it('brings a declared step back into this calculation alone', async () => {
		const step = $state(formula({ ...formulas[0], id: 'f-1', declarationId: 'decl-1', shared: true }));
		render(CellPanel, { row: rowFor('hs_k'), formula: step, formulas, variables });
		const whose = screen.getByLabelText(/^Read by/) as HTMLSelectElement;
		expect(whose.value).toBe('true');
		await userEvent.selectOptions(whose, 'false');
		expect(step.shared).toBe(false);
	});

	it('does not offer it on an output, which publishes under its own parameter', () => {
		render(CellPanel, { row: rowFor('CO2_HS_Um'), formula: formulas[1], formulas, variables });
		expect(screen.queryByLabelText(/^Read by/)).toBeNull();
	});

	it('bounds an output, and leaves a step unbounded', async () => {
		const output = $state(formula({ ...formulas[1] }));
		render(CellPanel, { row: rowFor('CO2_HS_Um'), formula: output, formulas, variables });
		await userEvent.type(screen.getByLabelText('Warning max'), '42');
		expect(output.thresholds.warningMax).toBe(42);
	});

	it('offers no bounds on a step, which publishes under no parameter', () => {
		render(CellPanel, { row: rowFor('hs_k'), formula: formulas[0], formulas, variables });
		expect(screen.queryByLabelText('Warning max')).toBeNull();
	});

	it('mounts no palette of its own, the page holding the one palette', () => {
		render(CellPanel, { row: rowFor('hs_k'), formula: formulas[0], formulas, variables });
		expect(screen.queryByPlaceholderText('Search…')).toBeNull();
	});

	it('hands a palette pick to the formula open in it, and to the one opened after it', async () => {
		const step = $state(formula({ ...formulas[0] }));
		const output = $state(formula({ ...formulas[1] }));
		const { component, rerender } = render(CellPanel, {
			row: rowFor('hs_k'),
			formula: step,
			formulas,
			variables,
		});
		await rerender({ row: rowFor('CO2_HS_Um'), formula: output });
		expect(component.pick({ kind: 'operator', op: '+' })).toBe(true);
		expect(output.formula).toBe('lab_co2 * hs_k + ?');
		expect(step.formula).toBe('exp(lab_temp / 100)');
	});

	it('holds the formula as it stood at focus until its field is left', async () => {
		const output = $state(formula({ ...formulas[1] }));
		let focused: { formula: EditableFormula; text: string } | null = null;
		const { component } = render(CellPanel, {
			row: rowFor('CO2_HS_Um'),
			formula: output,
			formulas,
			variables,
			get focused() {
				return focused;
			},
			set focused(value) {
				focused = value;
			},
		});
		await component.editFormula();
		expect(focused).toMatchObject({ text: 'lab_co2 * hs_k' });
		output.formula = 'lab_co2 * hs_k * l';
		expect(focused).toMatchObject({ text: 'lab_co2 * hs_k' });
		// Held while the press that left the field is down, so nothing moves under the pointer.
		const user = userEvent.setup();
		await user.pointer({ keys: '[MouseLeft>]', target: screen.getByLabelText('Code') });
		expect(document.activeElement).toBe(screen.getByLabelText('Code'));
		expect(focused).toMatchObject({ text: 'lab_co2 * hs_k' });
		await user.pointer({ keys: '[/MouseLeft]', target: screen.getByLabelText('Code') });
		await vi.waitFor(() => expect(focused).toBeNull());
	});

	it('takes no palette pick on an input, which has no formula', () => {
		const { component } = render(CellPanel, { row: rowFor('lab_temp'), formulas, variables });
		expect(component.pick({ kind: 'variable', name: 'lab_co2' })).toBe(false);
	});

	it('names the formulas that read a chosen input', () => {
		render(CellPanel, { row: rowFor('lab_temp'), formulas, variables });
		expect(screen.getByRole('button', { name: 'hs_k' })).toBeTruthy();
		expect(screen.queryByLabelText('Code')).toBeNull();
	});
});
