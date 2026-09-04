import { describe, expect, it } from 'vitest';
import { cellRole, editConsequence } from './role';

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
});
