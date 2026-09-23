import { describe, expect, it } from 'vitest';

import type { RunTraceStep } from '$api/service';
import { blankFormula, inputRows, type EditableFormula } from './editor';
import {
	cellEdit,
	contributors,
	dropOn,
	edgeColumn,
	emptyBlockLine,
	formulaOf,
	insertIdentifier,
	linksOf,
	rowKey,
	rowRemoval,
	sheetBlocks,
	stepsOffRefusal,
	withReplicate,
} from './sheet';
import { runInputTables, runTables } from '$lib/tools/runTable';
import type { Constant, Parameter } from '$api/crud';

const formula = (over: Partial<EditableFormula>): EditableFormula => ({
	...blankFormula([]),
	...over,
});

// pCO2's shape: a lab value read per replicate, a step over it, and an output the step feeds.
const set: EditableFormula[] = [
	formula({
		code: 'hs_k',
		formula: 'exp(lab_temp / 100)',
		intermediate: true,
		ordinal: 1,
	}),
	formula({
		code: 'CO2_HS_Um',
		name: 'CO2 headspace',
		units: 'uM',
		formula: 'lab_co2 * hs_k',
		per_replicate: 'lab_co2',
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
const constants: Constant[] = [];

describe('sheet blocks', () => {
	it('tags a constant, a curve coefficient and a site property with what supplies it', () => {
		const tagged = [
			formula({ code: 'out', formula: 'lab_co2 * R_gas + curve_slope + altitude', ordinal: 1 }),
		];
		const withGas = [{ name: 'R_gas', value: 8.314, units: 'J/mol/K' }] as Constant[];
		const [inputs] = sheetBlocks(tagged, inputRows(tagged, parameters, withGas));
		expect(inputs!.rows.map((r) => [r.key, r.tag ?? null])).toEqual([
			['lab_co2', null],
			['R_gas', 'constant'],
			['curve_slope', 'curve'],
			['altitude', 'site'],
		]);
	});

	it('tags a number the run was given that no formula names by where it came from', () => {
		const given = runInputTables([], [], {}, [
			{ name: 'co2', curve: { slope: 1.1, intercept: 0.2 } },
		] as Parameters<typeof runInputTables>[3]);
		const [inputs] = sheetBlocks(set, inputRows(set, parameters, constants), [], given);
		expect(inputs!.rows.filter((r) => r.tag).map((r) => [r.key, r.tag])).toEqual([
			['co2.slope', 'curve'],
			['co2.intercept', 'curve'],
		]);
	});

	it('bands the inputs, holds the steps apart and marks an output another formula reads', () => {
		const blocks = sheetBlocks(set, inputRows(set, parameters, constants, ['lab_co2']));
		expect(blocks.map((b) => b.key)).toEqual(['inputs', 'steps', 'outputs']);
		const [inputs, steps, outputs] = blocks;
		expect(inputs!.rows.map((r) => [r.key, r.band])).toEqual([
			['lab_temp', 'single'],
			['lab_co2', 'replicated'],
		]);
		expect(steps!.rows.map((r) => r.key)).toEqual(['hs_k']);
		expect(outputs!.rows.map((r) => [r.key, r.band])).toEqual([['CO2_HS_Um', 'final']]);
	});

	it('marks the rows that hold one value per replicate', () => {
		const [inputs, steps, outputs] = sheetBlocks(
			set,
			inputRows(set, parameters, constants, ['lab_co2']),
		);
		expect(inputs!.rows.map((r) => [r.key, r.replicated])).toEqual([
			['lab_temp', false],
			['lab_co2', true],
		]);
		expect(steps!.rows.map((r) => [r.key, r.replicated])).toEqual([['hs_k', false]]);
		expect(outputs!.rows.map((r) => [r.key, r.replicated])).toEqual([['CO2_HS_Um', true]]);
	});

	it('marks a step no formula reads', () => {
		const orphan = [
			...set,
			formula({ code: 'spare', formula: 'lab_temp * 2', intermediate: true }),
		];
		const blocks = sheetBlocks(orphan, inputRows(orphan, parameters, constants));
		const steps = blocks[1]!.rows;
		expect(steps.find((r) => r.key === 'hs_k')?.unused).toBe(false);
		expect(steps.find((r) => r.key === 'spare')?.unused).toBe(true);
	});

	it('stands before a run, with a row per formula and empty cells', () => {
		const blocks = sheetBlocks(set, inputRows(set, parameters, constants));
		expect(blocks.every((b) => b.columns.length === 0)).toBe(true);
		expect(blocks[2]!.rows[0]!.cells).toEqual([{ value: null, skipped: null }]);
	});

	it('draws every block against the replicate letters of the run', () => {
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
		const blocks = sheetBlocks(
			set,
			inputRows(set, parameters, constants, ['lab_co2']),
			[],
			given,
			tables,
		);
		expect(blocks.map((b) => b.columns)).toEqual([
			['A', 'B'],
			['A', 'B'],
			['A', 'B'],
		]);
		const co2 = blocks[0]!.rows.find((r) => r.key === 'lab_co2');
		expect(co2!.cells.map((c) => c.value)).toEqual([410, 430]);
		// A value read once per visit sits in the first column and leaves the rest empty.
		expect(blocks[0]!.rows.find((r) => r.key === 'lab_temp')!.cells.map((c) => c.value)).toEqual([
			21,
			null,
		]);
		expect(blocks[1]!.rows[0]!.cells[0]!.value).toBe(1.23);
		expect(blocks[2]!.rows[0]!.cells.map((c) => c.value)).toEqual([504.3, 528.9]);
	});

	it('carries the statistics of a run under the outputs', () => {
		const tables = runTables({ CO2_HS_Um_avg: 516.6, CO2_HS_Um_sd: 17.4 }, [
			{
				key: 'CO2_HS_Um_avg',
				label: 'CO2 headspace avg',
				units: 'uM',
				per_replicate: false,
				aggregate_of: 'CO2_HS_Um',
			},
			{
				key: 'CO2_HS_Um_sd',
				label: 'CO2 headspace sd',
				units: 'uM',
				per_replicate: false,
				aggregate_of: 'CO2_HS_Um',
			},
		] as Parameters<typeof runTables>[1]);
		const blocks = sheetBlocks(set, inputRows(set, parameters, constants), [], undefined, tables);
		expect(blocks[2]!.rows.map((r) => r.band)).toEqual(['final', 'statistics', 'statistics']);
		// A summary names the output whose repeats it is over, so selecting it can light them.
		expect(blocks[2]!.rows[1]!.aggregateOf).toBe('CO2_HS_Um');
	});

	it('shows an input brought in before a formula names it, marked unread', () => {
		const blocks = sheetBlocks(set, inputRows(set, parameters, constants), [
			{ name: 'lab_pressure', kind: 'parameter', detail: 'Lab pressure (hPa)' },
		]);
		const row = blocks[0]!.rows.find((r) => r.key === 'lab_pressure');
		expect(row?.unused).toBe(true);
		expect(row?.band).toBe('single');
	});

	it('shows a curve slot`s coefficients, which no variable names', () => {
		const withCurve = [
			formula({
				code: 'doc',
				formula: 'raw * curve_slope + curve_intercept',
				curve_slot: 'doc',
			}),
		];
		const given = runInputTables([], [], {}, [
			{
				name: 'doc',
				curve: { slope: 2, intercept: 0.5, label: 'DOC 2026-03' },
			},
		]);
		const blocks = sheetBlocks(withCurve, inputRows(withCurve, parameters, constants), [], given);
		expect(blocks[0]!.rows.map((r) => r.key)).toContain('doc.slope');
		expect(blocks[0]!.rows.find((r) => r.key === 'doc.intercept')?.cells[0]?.value).toBe(0.5);
	});
});

describe('links', () => {
	it('names what a formula reads of the set and what reads it', () => {
		expect(linksOf(set, 'hs_k')).toEqual({ reads: [], readBy: ['CO2_HS_Um'] });
		expect(linksOf(set, 'CO2_HS_Um')).toEqual({ reads: ['hs_k'], readBy: [] });
	});

	it('is empty for a code the set does not hold', () => {
		expect(linksOf(set, 'nothing')).toEqual({ reads: [], readBy: [] });
	});
});

describe('the formula in a row', () => {
	const blocks = sheetBlocks(set, inputRows(set, parameters, constants, ['lab_co2']));
	const row = (block: number, key: string) => blocks[block]!.rows.find((r) => r.key === key)!;

	it('shows what a step and an output compute', () => {
		expect(formulaOf(row(1, 'hs_k'))).toBe('exp(lab_temp / 100)');
		expect(formulaOf(row(2, 'CO2_HS_Um'))).toBe('lab_co2 * hs_k');
	});

	it('shows nothing on an input or a formula not yet written', () => {
		expect(formulaOf(row(0, 'lab_temp'))).toBeNull();
		const blank = sheetBlocks([formula({ code: 'x', formula: '  ' })], []);
		expect(formulaOf(blank.find((b) => b.key === 'outputs')!.rows[0]!)).toBeNull();
	});
});

describe('cell edits', () => {
	const blocks = sheetBlocks(set, inputRows(set, parameters, constants, ['lab_co2']));
	const row = (block: number, key: string) => blocks[block]!.rows.find((r) => r.key === key)!;

	it('types a value per replicate into a replicated input', () => {
		expect(cellEdit(row(0, 'lab_co2'), 2, '430')).toEqual({
			kind: 'replicate',
			name: 'lab_co2',
			index: 1,
			text: '430',
		});
	});

	it('types one value into an input read once per visit', () => {
		expect(cellEdit(row(0, 'lab_temp'), 1, '21')).toEqual({
			kind: 'scalar',
			name: 'lab_temp',
			text: '21',
		});
		expect(cellEdit(row(0, 'lab_temp'), 2, '21')).toBeNull();
	});

	it('renames a formula from its label cell, and refuses a computed value', () => {
		expect(cellEdit(row(2, 'CO2_HS_Um'), 0, 'CO2_HS')).toEqual({
			kind: 'code',
			key: 'CO2_HS_Um',
			text: 'CO2_HS',
		});
		expect(cellEdit(row(2, 'CO2_HS_Um'), 1, '12')).toBeNull();
		expect(cellEdit(row(0, 'lab_co2'), 0, 'x')).toBeNull();
	});

	it('leaves a step read through a declaration to the calculation that owns it', () => {
		const withDeclared = [
			...set,
			formula({
				code: 'water_k',
				formula: 'lab_temp + 273.15',
				intermediate: true,
				declarationId: 'decl-1',
				ordinal: 3,
			}),
		];
		const steps = sheetBlocks(withDeclared, inputRows(withDeclared, parameters, constants))[1]!;
		const declared = steps.rows.find((r) => r.key === 'water_k')!;
		const owned = steps.rows.find((r) => r.key === 'hs_k')!;
		expect(cellEdit(declared, 0, 'x')).toBeNull();
		expect(cellEdit(owned, 0, 'x')).toEqual({ kind: 'code', key: 'hs_k', text: 'x' });
	});
});

describe('inserting an identifier', () => {
	it('appends when there is no caret', () => {
		expect(insertIdentifier('a * ', 'b')).toEqual({
			formula: 'a * b',
			caret: 5,
		});
	});

	it('spaces the name off the text it would run into', () => {
		expect(insertIdentifier('ab', 'cd', 2)).toEqual({
			formula: 'ab cd',
			caret: 5,
		});
		expect(insertIdentifier('(x)', 'y', 1)).toEqual({
			formula: '(y x)',
			caret: 2,
		});
	});

	it('needs no space inside an operator', () => {
		expect(insertIdentifier('a * (', 'b', 5)).toEqual({
			formula: 'a * (b',
			caret: 6,
		});
	});
});

describe('contributors', () => {
	const trace: RunTraceStep[] = [
		{
			code: 'CO2_HS_Um',
			label: 'CO2 headspace',
			units: 'uM',
			formula: 'lab_co2 * hs_k',
			intermediate: false,
			per_replicate: true,
			output_parameter_code: 'CO2_HS_Um',
			cells: [
				{ index: 0, value: 504.3, bindings: { hs_k: 1.23, lab_co2: 410 } },
				{
					index: 1,
					value: null,
					skipped: 'no value for lab_co2',
					bindings: {},
				},
			],
		},
	];

	it('reads a cell`s values in the order the formula names them', () => {
		expect(contributors(trace, 'CO2_HS_Um', 0)).toEqual([
			{ name: 'lab_co2', value: 410 },
			{ name: 'hs_k', value: 1.23 },
		]);
	});

	it('gives nothing for a cell that never ran, or a code with no step', () => {
		expect(contributors(trace, 'CO2_HS_Um', 1)).toEqual([]);
		expect(contributors(trace, 'hs_k', 0)).toEqual([]);
	});
});

describe('a formula with no code yet', () => {
	it('is a row of its own, keyed on its place until it is named', () => {
		const fresh = [...set, formula({ code: '', formula: '', ordinal: 9 })];
		const blocks = sheetBlocks(fresh, inputRows(fresh, parameters, constants));
		const row = blocks[2]!.rows.find((r) => r.key === 'new-9');
		expect(row).toBeTruthy();
		expect(row!.code).toBeNull();
		expect(rowKey(formula({ code: ' CO2 ', ordinal: 9 }))).toBe('CO2');
	});

	it('takes a code typed into its label cell', () => {
		const fresh = [...set, formula({ code: '', formula: '', ordinal: 9 })];
		const blocks = sheetBlocks(fresh, inputRows(fresh, parameters, constants));
		const row = blocks[2]!.rows.find((r) => r.key === 'new-9')!;
		expect(cellEdit(row, 0, 'hs_p')).toEqual({ kind: 'code', key: 'new-9', text: 'hs_p' });
	});
});

describe('typed replicate lists', () => {
	it('writes one position and leaves the rest', () => {
		expect(withReplicate('410, 430', 1, '431')).toBe('410, 431');
		expect(withReplicate('', 0, '410')).toBe('410');
	});

	it('fills in the positions before one typed out of order', () => {
		expect(withReplicate('', 2, '450')).toBe(', , 450');
	});

	it('drops the trailing gaps a cleared cell leaves', () => {
		expect(withReplicate('410, 430', 1, '')).toBe('410');
		expect(withReplicate('410', 0, '')).toBe('');
	});
});

describe('a palette entry dropped on a block', () => {
	const blocks = sheetBlocks(set, inputRows(set, parameters, constants, ['lab_co2']));
	const row = (block: number, key: string) => blocks[block]!.rows.find((r) => r.key === key)!;

	it('brings an input in on the inputs block, wherever it lands', () => {
		expect(dropOn('inputs', row(0, 'lab_co2'))).toEqual({ kind: 'input' });
		expect(dropOn('inputs', null)).toEqual({ kind: 'input' });
	});

	it('writes into the formula of a row that computes one', () => {
		expect(dropOn('steps', row(1, 'hs_k'))).toEqual({ kind: 'identifier', key: 'hs_k' });
		expect(dropOn('outputs', null)).toBeNull();
	});
});

// Scenario: a fresh calculation, whose three blocks are all empty.
//
// Expected behaviour: each says how a row arrives there, so the sheet teaches its first gesture
// in every block rather than only in the one that takes a drop. Read-only, each says only that it
// is empty: there is nothing a reader could do about it.
describe('emptyBlockLine', () => {
	it('names the drop the inputs block takes', () => {
		expect(emptyBlockLine('inputs', true)).toContain('Drop a parameter or constant here');
	});

	it('names the button each computed block takes', () => {
		expect(emptyBlockLine('steps', true)).toContain('Add step');
		expect(emptyBlockLine('outputs', true)).toContain('Add output');
	});

	it('says only that a read-only block is empty', () => {
		for (const block of ['inputs', 'steps', 'outputs'] as const) {
			const line = emptyBlockLine(block, false);
			expect(line).not.toContain('Add ');
			expect(line).not.toContain('Drop ');
		}
	});
});

describe('the steps block', () => {
	const single = [formula({ code: 'out', formula: 'lab_co2 * 2', ordinal: 1 })];

	it('is left out of a set with no step when steps are off', () => {
		const blocks = sheetBlocks(single, inputRows(single, parameters, constants), [], undefined, undefined, false);
		expect(blocks.map((b) => b.key)).toEqual(['inputs', 'outputs']);
	});

	it('stands between the inputs and the outputs when steps are on', () => {
		const blocks = sheetBlocks(single, inputRows(single, parameters, constants), [], undefined, undefined, true);
		expect(blocks.map((b) => b.key)).toEqual(['inputs', 'steps', 'outputs']);
		expect(blocks[1]!.rows).toEqual([]);
	});

	it('stays while the set holds a step, whatever the switch says', () => {
		const blocks = sheetBlocks(set, inputRows(set, parameters, constants), [], undefined, undefined, false);
		expect(blocks.map((b) => b.key)).toEqual(['inputs', 'steps', 'outputs']);
	});

	it('may be turned off when the set holds no step', () => {
		expect(stepsOffRefusal(single)).toBeNull();
	});

	it('refuses to be turned off while a step stands, naming it', () => {
		expect(stepsOffRefusal(set)).toBe('Steps stay on while the calculation has a step: hs_k.');
		const two = [...set, formula({ code: '', intermediate: true, ordinal: 3 })];
		expect(stepsOffRefusal(two)).toBe(
			'Steps stay on while the calculation has steps: hs_k, an unnamed step.',
		);
	});
});

describe('edgeColumn', () => {
	it('leaves a source row from its last cell', () => {
		// label plus three replicate columns
		expect(edgeColumn('source', 3)).toBe(3);
	});

	it('leaves a block with no value columns from the one blank cell the grid draws', () => {
		expect(edgeColumn('source', 0)).toBe(1);
	});

	it('meets the reader at its label cell', () => {
		expect(edgeColumn('reader', 3)).toBe(0);
	});
});

describe('removing a row', () => {
	const blocks = (declared: string[] = []) =>
		sheetBlocks(
			set,
			inputRows(set, parameters, constants),
			declared.map((name) => ({ name, kind: 'parameter' as const, detail: '' })),
		);
	const row = (key: string, declared: string[] = []) =>
		blocks(declared)
			.flatMap((b) => b.rows)
			.find((r) => r.key === key)!;

	it('drops an output nothing reads', () => {
		expect(rowRemoval(row('CO2_HS_Um'), set, [])).toEqual({
			kind: 'formula',
			key: 'CO2_HS_Um',
			readers: [],
		});
	});

	it('names the formulas still reading a step', () => {
		expect(rowRemoval(row('hs_k'), set, [])).toEqual({
			kind: 'formula',
			key: 'hs_k',
			readers: ['CO2_HS_Um'],
		});
	});

	it('drops a formula with no code yet by its place in the set', () => {
		const blank = [...set, formula({ code: '', ordinal: 3 })];
		expect(rowRemoval({ ...row('CO2_HS_Um'), key: 'new-3', code: null }, blank, [])).toEqual({
			kind: 'formula',
			key: 'new-3',
			readers: [],
		});
	});

	it('takes an input brought in by hand back out', () => {
		expect(rowRemoval(row('Field_BP', ['Field_BP']), set, ['Field_BP'])).toEqual({
			kind: 'input',
			name: 'Field_BP',
		});
	});

	it('refuses an input a formula still reads, naming the formula', () => {
		expect(rowRemoval(row('lab_temp'), set, [])).toEqual({
			kind: 'refused',
			reason: 'lab_temp is read by hs_k.',
		});
		expect(rowRemoval(row('lab_temp', ['lab_temp']), set, ['lab_temp'])).toEqual({
			kind: 'refused',
			reason: 'lab_temp is read by hs_k.',
		});
	});

	it('stops reading a shared step rather than dropping it', () => {
		const shared = set.map((f) =>
			f.code === 'hs_k' ? { ...f, declarationId: 'd1', shared: true } : f,
		);
		expect(rowRemoval(row('hs_k'), shared, [])).toEqual({ kind: 'stop-reading', key: 'hs_k' });
	});

	it('leaves a step another calculation owns alone', () => {
		const owned = set.map((f) => (f.code === 'hs_k' ? { ...f, declarationId: 'd1' } : f));
		expect(rowRemoval(row('hs_k'), owned, [])).toBeNull();
	});

	it('has no remove on a statistic', () => {
		expect(
			rowRemoval({ ...row('CO2_HS_Um'), key: 'CO2_HS_Um_avg', band: 'statistics', code: null }, set, []),
		).toBeNull();
	});
});

describe('typed input values', () => {
	const rows = inputRows(set, parameters, constants, ['lab_co2']);
	// The run's echo carries only what it resolved from storage: a typed input is absent from it.
	const echo = runInputTables([{ param: 'lab_co2', value: [410, 430] }], [], {}, []);
	const inputCells = (blocks: ReturnType<typeof sheetBlocks>, key: string) =>
		blocks[0]!.rows.find((r) => r.key === key)!.cells;

	it('keeps a typed scalar in its cell, marked, when the echo omits it', () => {
		const blocks = sheetBlocks(set, rows, [], echo, undefined, true, {
			scalars: { lab_temp: '21.5' },
			replicates: {},
		});
		expect(inputCells(blocks, 'lab_temp')[0]).toEqual({ value: 21.5, skipped: null, typed: true });
	});

	it('keeps a typed replicate over the echoed or hovered one, and leaves the rest', () => {
		const hovered = runInputTables([
			{ param: 'lab_co2', value: [1, 2] },
			{ param: 'lab_temp', value: 3 },
		]);
		const blocks = sheetBlocks(set, rows, [], hovered, undefined, true, {
			scalars: {},
			replicates: { lab_co2: ', 999' },
		});
		const cells = inputCells(blocks, 'lab_co2');
		expect(cells[0]).toMatchObject({ value: 1 });
		expect(cells[0]!.typed).toBeFalsy();
		expect(cells[1]).toEqual({ value: 999, skipped: null, typed: true });
		expect(inputCells(blocks, 'lab_temp')[0]).toMatchObject({ value: 3 });
	});

	it('falls back to the echo when the typed entry is empty or not a number', () => {
		for (const text of ['', '  ', 'abc']) {
			const blocks = sheetBlocks(set, rows, [], echo, undefined, true, {
				scalars: { lab_temp: text },
				replicates: { lab_co2: text },
			});
			expect(inputCells(blocks, 'lab_co2')[0]).toMatchObject({ value: 410 });
			expect(inputCells(blocks, 'lab_co2')[0]!.typed).toBeFalsy();
			expect(inputCells(blocks, 'lab_temp')[0]).toEqual({ value: null, skipped: null });
		}
	});
});
