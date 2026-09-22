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

	it('leaves a shared step read-only, with what it feeds and a way to stop reading it', () => {
		const shared = formula({ ...formulas[0], declarationId: 'decl-1' });
		render(CellPanel, {
			row: rowFor('hs_k'),
			formula: shared,
			formulas,
			variables,
		});
		expect(screen.queryByLabelText('Code')).toBeNull();
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

	it('names the formulas that read a chosen input', () => {
		render(CellPanel, { row: rowFor('lab_temp'), formulas, variables });
		expect(screen.getByRole('button', { name: 'hs_k' })).toBeTruthy();
		expect(screen.queryByLabelText('Code')).toBeNull();
	});
});

// Scenario: the author opens an input the lab measures at a visit, on a calculation whose output
// a site fills from a stream (Q230).
//
// Expected behaviour: the panel offers how the set reaches it, says what each choice does, and
// emits the change. A row the rule does not apply to is offered nothing.
describe('how an input is reached between visits', () => {
	it('offers the rule on the input, and says what holding it does', async () => {
		const onhold = vi.fn();
		render(CellPanel, {
			row: rowFor('lab_co2'),
			formulas,
			variables,
			held: false,
			onhold,
		});
		const choice = screen.getByLabelText('Between visits') as HTMLSelectElement;
		expect(choice.value).toBe('exact');
		expect(screen.getByText(/An instant with no reading of it computes nothing/)).toBeTruthy();

		await userEvent.selectOptions(choice, 'hold');
		expect(onhold).toHaveBeenCalledWith(true);
	});

	it('says what a held input does once it is held', () => {
		render(CellPanel, { row: rowFor('lab_co2'), formulas, variables, held: true });
		expect((screen.getByLabelText('Between visits') as HTMLSelectElement).value).toBe('hold');
		expect(screen.getByText(/carries the number last measured/)).toBeTruthy();
	});

	it('offers nothing where the rule does not apply', () => {
		render(CellPanel, { row: rowFor('hs_k'), formula: formulas[0], formulas, variables });
		expect(screen.queryByLabelText('Between visits')).toBeNull();
	});
});
