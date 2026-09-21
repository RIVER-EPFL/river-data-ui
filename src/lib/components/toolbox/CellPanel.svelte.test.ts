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

	it('names the formulas that read a chosen input', () => {
		render(CellPanel, { row: rowFor('lab_temp'), formulas, variables });
		expect(screen.getByRole('button', { name: 'hs_k' })).toBeTruthy();
		expect(screen.queryByLabelText('Code')).toBeNull();
	});
});
