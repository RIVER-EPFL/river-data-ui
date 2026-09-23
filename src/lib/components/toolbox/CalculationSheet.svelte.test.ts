import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
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

/** A cell's own text: a label cell also carries the formula of its row on a line of its own. */
const labelOf = (td: Element) => td.firstChild?.textContent ?? '';

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

	it('draws a row per input, step and output with no heading rows between them', async () => {
		const view = render(CalculationSheet, { blocks: blocks(), formulas });
		await waitFor(() => expect(view.container.textContent).toContain('CO2 headspace'));
		const labels = [...view.container.querySelectorAll('td[data-sheet-column="0"]')].map(
			(td) => td.getAttribute('data-sheet-row'),
		);
		expect(labels).toEqual(['lab_temp', 'lab_co2', 'hs_k', 'spare', 'CO2_HS_Um']);
		expect(view.container.textContent).not.toMatch(/Per replicate|One per visit|Published/);
	});

	it('marks a step no formula reads', async () => {
		const view = render(CalculationSheet, { blocks: blocks(), formulas });
		await waitFor(() =>
			expect(view.container.querySelectorAll('.sheet-unused').length).toBeGreaterThan(0),
		);
		const marked = [...view.container.querySelectorAll('td.sheet-unused')].map(labelOf);
		expect(marked).toContain('spare');
		expect(marked).not.toContain('hs_k');
	});

	it('shows the formula a row computes under its name', async () => {
		const view = render(CalculationSheet, { blocks: blocks(), formulas });
		await waitFor(() => expect(view.container.textContent).toContain('CO2 headspace'));
		const lines = [...view.container.querySelectorAll('.sheet-formula')].map((el) => el.textContent);
		expect(lines).toEqual(
			expect.arrayContaining(['exp(lab_temp / 100)', 'lab_temp * 2', 'lab_co2 * hs_k']),
		);
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
		const reads = [...view.container.querySelectorAll('td.sheet-reads')].map(labelOf);
		expect(reads).toContain('hs_k');
		expect(reads).toContain('lab_co2');
		const readBy = [...view.container.querySelectorAll('td.sheet-read-by')].map(labelOf);
		expect(readBy).toHaveLength(0);
	});
});

describe('the tables as they are worked on', () => {
	it('dims the numbers while a rerun of changed inputs is in flight', async () => {
		const view = render(CalculationSheet, { blocks: blocks(), formulas, stale: true });
		await waitFor(() =>
			expect(view.container.querySelectorAll('td.sheet-stale').length).toBeGreaterThan(0),
		);
		const dimmed = [...view.container.querySelectorAll('td.sheet-stale')].map(labelOf);
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

	it('takes a palette drop on an inputs block with no rows yet', async () => {
		const ondrop = vi.fn();
		const view = render(CalculationSheet, { blocks: sheetBlocks([], []), formulas: [], ondrop });
		const inputs = view.container.querySelector('section[aria-label="Inputs"]')!;
		const payload = { name: 'Field_BP', kind: 'parameter' };
		fireEvent.drop(inputs, {
			dataTransfer: { getData: () => JSON.stringify(payload) },
		});
		expect(ondrop).toHaveBeenCalledWith('inputs', null, payload);
		expect(inputs.textContent).toContain('Drop a parameter or constant here');
	});

	it('leaves an empty steps or outputs block alone, having no row to write into', async () => {
		const ondrop = vi.fn();
		const view = render(CalculationSheet, { blocks: sheetBlocks([], []), formulas: [], ondrop });
		for (const title of ['Steps', 'Outputs']) {
			fireEvent.drop(view.container.querySelector(`section[aria-label="${title}"]`)!, {
				dataTransfer: { getData: () => JSON.stringify({ name: 'Field_BP', kind: 'parameter' }) },
			});
		}
		expect(ondrop).not.toHaveBeenCalled();
		// So each says the button it does take, rather than only that it is empty.
		for (const [title, said] of [
			['Steps', 'Add step'],
			['Outputs', 'Add output'],
		]) {
			expect(
				view.container.querySelector(`section[aria-label="${title}"]`)!.textContent,
			).toContain(said);
		}
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

describe('the steps switch', () => {
	const single = [formula({ code: 'out', formula: 'lab_co2 * 2' })];

	it('draws a calculation with no step as two tables, with Add step beside Add output', async () => {
		const onadd = vi.fn();
		const view = render(CalculationSheet, {
			blocks: sheetBlocks(single, [], [], undefined, undefined, false),
			formulas: single,
			onadd,
			onsteps: vi.fn(),
		});
		expect(view.container.querySelector('section[aria-label="Steps"]')).toBeNull();
		expect(view.container.querySelector('.\\@md\\:grid-cols-2')).not.toBeNull();
		expect(view.container.querySelector('.\\@2xl\\:grid-cols-3')).toBeNull();
		expect((screen.getByRole('checkbox', { name: 'Intermediate steps' }) as HTMLInputElement).checked).toBe(false);
		await userEvent.click(screen.getByRole('button', { name: 'Add step' }));
		expect(onadd).toHaveBeenCalledWith('steps');
	});

	it('turns the steps on', async () => {
		const onsteps = vi.fn();
		render(CalculationSheet, {
			blocks: sheetBlocks(single, [], [], undefined, undefined, false),
			formulas: single,
			onsteps,
		});
		await userEvent.click(screen.getByRole('checkbox', { name: 'Intermediate steps' }));
		expect(onsteps).toHaveBeenCalledWith(true);
	});

	it('refuses to turn the steps off while one stands, and says which', async () => {
		const onsteps = vi.fn();
		render(CalculationSheet, { blocks: blocks(), formulas, onsteps });
		const box = screen.getByRole('checkbox', { name: 'Intermediate steps' });
		await userEvent.click(box);
		expect(onsteps).not.toHaveBeenCalled();
		expect((box as HTMLInputElement).checked).toBe(true);
		expect(screen.getByText(/^Steps stay on/).textContent).toContain('hs_k');
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

describe('the remove control on a row', () => {
	it('drops a step nothing reads at once', async () => {
		const onremove = vi.fn();
		render(CalculationSheet, { blocks: blocks(), formulas, onremove });
		await userEvent.click(await screen.findByRole('button', { name: 'Remove spare' }));
		expect(onremove).toHaveBeenCalledWith({ kind: 'formula', key: 'spare', readers: [] });
	});

	it('asks before dropping a step another formula reads, naming it', async () => {
		const onremove = vi.fn();
		render(CalculationSheet, { blocks: blocks(), formulas, onremove });
		await userEvent.click(await screen.findByRole('button', { name: 'Remove hs_k' }));
		expect(onremove).not.toHaveBeenCalled();
		const dialog = screen.getByRole('alertdialog');
		expect(dialog.textContent).toContain('CO2_HS_Um still reads it');
		await userEvent.click(screen.getByRole('button', { name: 'Drop' }));
		expect(onremove).toHaveBeenCalledWith({ kind: 'formula', key: 'hs_k', readers: ['CO2_HS_Um'] });
	});

	it('refuses an input a formula reads, saying which', async () => {
		const onremove = vi.fn();
		render(CalculationSheet, { blocks: blocks(), formulas, onremove });
		await userEvent.click(await screen.findByRole('button', { name: 'Remove lab_temp' }));
		expect(onremove).not.toHaveBeenCalled();
		expect(screen.getByText('lab_temp is read by hs_k, spare.')).toBeTruthy();
	});

	it('draws no remove control on a read-only sheet', async () => {
		const view = render(CalculationSheet, { blocks: blocks(), formulas });
		await waitFor(() => expect(view.container.textContent).toContain('CO2 headspace'));
		expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
	});
});

describe('a typed input value', () => {
	it('is drawn marked as typed', async () => {
		const typed = sheetBlocks(
			formulas,
			inputRows(formulas, parameters, [], ['lab_co2']),
			[],
			undefined,
			undefined,
			true,
			{ scalars: { lab_temp: '25' }, replicates: {} },
		);
		const view = render(CalculationSheet, { blocks: typed, formulas });
		await waitFor(() =>
			expect(view.container.querySelectorAll('td.sheet-typed').length).toBeGreaterThan(0),
		);
		const marked = [...view.container.querySelectorAll('td.sheet-typed')].map((td) => td.textContent);
		expect(marked).toEqual(['25']);
	});
});
