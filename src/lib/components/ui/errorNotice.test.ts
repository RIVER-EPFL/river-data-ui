import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Scenario: a page that failed to load or parse shows its error through ErrorNotice, so the same
// failure reads as the same bordered box on every page.
describe('page errors', () => {
	const root = fileURLToPath(new URL('../../..', import.meta.url));
	const sources = readdirSync(root, { recursive: true, encoding: 'utf-8' })
		.filter((f) => f.endsWith('.svelte') && !f.endsWith('ErrorNotice.svelte'))
		.map((f) => ({ file: f, text: readFileSync(`${root}/${f}`, 'utf-8') }));

	it('draw no alarm box of their own', () => {
		const box =
			/<(div|p)\b[^>]*class="(?![^"]*text-xs)[^"]*\bseverity-alarm[^"]*"[^>]*>\s*(?:[A-Za-z ]+:\s*)?\{(?:error|parseError)\}\s*<\/\1>/;
		const found = sources.filter(({ text }) => box.test(text)).map(({ file }) => file);
		expect(found).toEqual([]);
	});
});
