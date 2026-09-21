import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import CalculationSheet from './CalculationSheet.svelte';
import { blankFormula, inputRows, type EditableFormula } from '$lib/calculations/editor';
import { sheetBlocks } from '$lib/calculations/sheet';
import { runInputTables, runTables } from '$lib/tools/runTable';
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
		code: 'spare',
		formula: 'lab_temp * 2',
		intermediate: true,
		ordinal: 2,
	}),
	formula({
		code: 'CO2_HS_Um',
		name: 'CO2 headspace',
		units: 'uM',
		formula: 'lab_co2 * hs_k',
		per_replicate: 'lab_co2',
		ordinal: 3,
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

function blocks() {
	const given = runInputTables(
		[
			{ param: 'lab_co2', value: [410, 430] },
			{ param: 'lab_temp', value: 21 },
		],
		[],
		{},
		[],
	);
	const tables = runTables({ hs_k: 1.23, CO2_HS_Um_A: 504.3, CO2_HS_Um_B: 528.9 }, [
		{
			key: 'CO2_HS_Um_{rep}',
			label: 'CO2 headspace',
			units: 'uM',
			per_replicate: true,
			aggregate_of: null,
		},
	] as Parameters<typeof runTables>[1]);
	return sheetBlocks(formulas, inputRows(formulas, parameters, [], ['lab_co2']), [], given, tables);
}

describe('CalculationSheet', () => {
	it('draws the inputs, the steps and the outputs as three tables of the run', async () => {
		const view = render(CalculationSheet, { blocks: blocks(), formulas });
		await waitFor(() => expect(view.container.textContent).toContain('CO2 headspace'));
		expect(view.container.querySelectorAll('.sheet-grid')).toHaveLength(3);
		const text = view.container.textContent ?? '';
		// The grid renders the columns its viewport holds, which under jsdom is the first; the
		// pivot across every letter is `sheet.test.ts`.
		for (const wanted of ['lab_co2', '410', 'lab_temp', '21', 'hs_k', '1.23', '504.300']) {
			expect(text).toContain(wanted);
		}
	});

	it('marks a step no formula reads', async () => {
		const view = render(CalculationSheet, { blocks: blocks(), formulas });
		await waitFor(() =>
			expect(view.container.querySelectorAll('.sheet-unused').length).toBeGreaterThan(0),
		);
		const marked = [...view.container.querySelectorAll('td.sheet-unused')].map(
			(td) => td.textContent,
		);
		expect(marked).toContain('spare');
		expect(marked).not.toContain('hs_k');
	});

	it('lights what the selected row reads and what reads it', async () => {
		const view = render(CalculationSheet, { blocks: blocks(), formulas });
		await waitFor(() => expect(view.container.textContent).toContain('CO2 headspace'));
		expect(view.container.querySelectorAll('.sheet-reads')).toHaveLength(0);
		await view.rerender({
			selected: { block: 'outputs' as const, key: 'CO2_HS_Um', column: 0 },
		});
		await waitFor(() =>
			expect(view.container.querySelectorAll('.sheet-reads').length).toBeGreaterThan(0),
		);
		const reads = [...view.container.querySelectorAll('td.sheet-reads')].map(
			(td) => td.textContent,
		);
		expect(reads).toContain('hs_k');
		expect(reads).toContain('lab_co2');
		const readBy = [...view.container.querySelectorAll('td.sheet-read-by')].map(
			(td) => td.textContent,
		);
		expect(readBy).toHaveLength(0);
	});
});

describe('the tables as they are worked on', () => {
	it('dims the numbers while a rerun of changed inputs is in flight', async () => {
		const view = render(CalculationSheet, { blocks: blocks(), formulas, stale: true });
		await waitFor(() =>
			expect(view.container.querySelectorAll('td.sheet-stale').length).toBeGreaterThan(0),
		);
		const dimmed = [...view.container.querySelectorAll('td.sheet-stale')].map(
			(td) => td.textContent,
		);
		// Only what the set computed: an input cell holds what was typed into it.
		expect(dimmed).toContain('hs_k');
		expect(dimmed).not.toContain('lab_co2');
	});

	it('appends to the steps and to the outputs from a button of each table', async () => {
		const onadd = vi.fn();
		render(CalculationSheet, { blocks: blocks(), formulas, onadd });
		await userEvent.click(screen.getByRole('button', { name: 'Add step' }));
		expect(onadd).toHaveBeenCalledWith('steps');
		await userEvent.click(screen.getByRole('button', { name: 'Add output' }));
		expect(onadd).toHaveBeenCalledWith('outputs');
		expect(screen.queryByRole('button', { name: 'Add input' })).toBeNull();
	});

	it('says what an outlined input row is, once, under the table', async () => {
		const declared = [{ name: 'lab_pressure', kind: 'parameter' as const, detail: 'Lab pressure' }];
		const view = render(CalculationSheet, {
			blocks: sheetBlocks(formulas, inputRows(formulas, parameters, [], ['lab_co2']), declared),
			formulas,
		});
		await waitFor(() => expect(view.container.textContent).toContain('read by no formula yet'));
		expect(view.container.textContent).toContain('the save does not keep it');
	});
});

describe('links drawn between the tables', () => {
	it('draws one line from the selected cell to each cell it reads', async () => {
		const view = render(CalculationSheet, { blocks: blocks(), formulas });
		await waitFor(() => expect(view.container.textContent).toContain('CO2 headspace'));
		expect(view.container.querySelectorAll('line')).toHaveLength(0);

		await view.rerender({ selected: { block: 'outputs' as const, key: 'CO2_HS_Um', column: 0 } });
		await waitFor(() => expect(view.container.querySelectorAll('line').length).toBeGreaterThan(0));
		const drawn = [...view.container.querySelectorAll('line')].map((l) =>
			l.getAttribute('data-sheet-edge'),
		);
		expect(drawn).toContain('hs_k');
		expect(drawn).toContain('lab_co2');
		expect(drawn).not.toContain('CO2_HS_Um');
	});

	it('draws nothing once the selection is gone', async () => {
		const view = render(CalculationSheet, {
			blocks: blocks(),
			formulas,
			selected: { block: 'outputs' as const, key: 'CO2_HS_Um', column: 0 },
		});
		await waitFor(() => expect(view.container.querySelectorAll('line').length).toBeGreaterThan(0));
		await view.rerender({ selected: null });
		await waitFor(() => expect(view.container.querySelectorAll('line')).toHaveLength(0));
	});
});
