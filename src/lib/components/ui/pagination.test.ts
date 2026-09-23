import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Scenario: a list that pages its rows draws the pager with PaginationControls, so the total and
// the page numbering read the same on every list and a change to the pager reaches all of them.
describe('paged lists', () => {
	const root = fileURLToPath(new URL('../../..', import.meta.url));
	const sources = readdirSync(root, { recursive: true, encoding: 'utf-8' })
		.filter((f) => f.endsWith('.svelte') && !f.endsWith('PaginationControls.svelte'))
		.map((f) => ({ file: f, text: readFileSync(`${root}/${f}`, 'utf-8') }));

	it('draw no Prev and Next pager of their own', () => {
		const pager = />\s*Prev\s*<\/Button>/;
		const found = sources.filter(({ text }) => pager.test(text)).map(({ file }) => file);
		expect(found).toEqual([]);
	});
});
