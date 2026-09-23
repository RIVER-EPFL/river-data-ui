import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('..', import.meta.url));

function svelteFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return svelteFiles(path);
		return entry.name.endsWith('.svelte') ? [path] : [];
	});
}

const NON_MARKUP = /<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g;
// A markup text node holding three dots, outside any `{...}` expression.
const THREE_DOT_TEXT = />[^<>{}]*\.\.\.[^<>{}]*</g;

function markup(file: string): string {
	return readFileSync(file, 'utf-8').replace(NON_MARKUP, '');
}

describe('markup text uses the ellipsis character', () => {
	it('has no three-dot text node in any component', () => {
		const offenders = svelteFiles(SRC).flatMap((file) =>
			[...markup(file).matchAll(THREE_DOT_TEXT)].map(
				(m) => `${file.slice(SRC.length)}: ${m[0].trim()}`
			)
		);
		expect(offenders).toEqual([]);
	});
});
