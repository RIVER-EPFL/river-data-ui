import { describe, expect, it } from 'vitest';
import { cellRole, cellWritable, editConsequence } from './role';

describe('cellRole', () => {
	it('leaves a plain measurement unmarked, so the marked cells stand out', () => {
		const info = cellRole({});
		expect(info.role).toBe('plain');
		expect(info.className).toBe('');
		expect(info.title).toBeNull();
	});

	it('names the scripts that read an input, and what editing it does', () => {
		const info = cellRole({ read_by: ['dom', 'doc'] });
		expect(info.role).toBe('input');
		expect(info.title).toContain('Read by dom, doc');
		expect(info.title).toContain('recomputes');
	});

	it('calls a computed value an output first, even when something reads it in turn', () => {
		const info = cellRole({ written_by: 'doc', read_by: ['dom'] });
		expect(info.role).toBe('output');
		expect(info.title).toBe('Computed by doc, read by dom');
	});
});

describe('editConsequence', () => {
	it('says nothing when nothing reads the value', () => {
		expect(editConsequence([])).toBeNull();
	});

	it('names each script and the parameters it will rewrite', () => {
		const text = editConsequence([
			{ tool: 'dom', label: 'DOM Indices', outputs: [{ parameter_code: 'SUVA' }] },
			{ tool: 'doc', label: 'DOC', outputs: [] },
		]);
		expect(text).toContain('2 calculations');
		expect(text).toContain('DOM Indices rewrites SUVA');
		expect(text).toContain('DOC runs again');
	});

	it('names what each output holds today, so the move is readable before it is made', () => {
		const text = editConsequence(
			[{ tool: 'dom', label: 'DOM Indices', outputs: [{ parameter_code: 'SUVA' }] }],
			{ SUVA: 3.4 },
		);
		expect(text).toContain('SUVA (now 3.4)');
	});

	it('says an output holds nothing yet rather than showing a blank', () => {
		const text = editConsequence(
			[{ tool: 'dom', label: 'DOM Indices', outputs: [{ parameter_code: 'SUVA' }] }],
			{ SUVA: null },
		);
		expect(text).toContain('SUVA (no value yet)');
		expect(
			editConsequence([
				{ tool: 'dom', label: 'DOM Indices', outputs: [{ parameter_code: 'SUVA' }] },
			]),
		).toContain('SUVA (no value yet)');
	});

	it('names a zero as the value it is', () => {
		const text = editConsequence(
			[{ tool: 'dom', label: 'DOM Indices', outputs: [{ parameter_code: 'SUVA' }] }],
			{ SUVA: 0 },
		);
		expect(text).toContain('SUVA (now 0)');
	});
});

describe('cellWritable', () => {
	it('lets a river member and above type into any cell', () => {
		for (const level of [2, 3, 4]) {
			expect(cellWritable(level, null).writable).toBe(true);
			expect(cellWritable(level, 120).writable).toBe(true);
		}
	});

	it('lets an intern enter a measurement but not change a stored one', () => {
		expect(cellWritable(1, null).writable).toBe(true);
		const stored = cellWritable(1, 120);
		expect(stored.writable).toBe(false);
		expect(stored.reason).toContain("manager's to change");
	});

	it('treats a zero as a stored value, not an empty cell', () => {
		expect(cellWritable(1, 0).writable).toBe(false);
	});

	it('gives an account with no level nothing to type into', () => {
		expect(cellWritable(0, null)).toEqual({
			writable: false,
			reason: 'Your account holds no level that may enter data.',
		});
	});
});
