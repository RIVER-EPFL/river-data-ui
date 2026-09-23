import { readdirSync } from 'node:fs';
import { matchesGlob } from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../../playwright.config';

describe('playwright config', () => {
	it('collects the stories and none of the vitest files beside them', () => {
		const testMatch = config.testMatch;
		expect(testMatch, "Playwright's default match also collects *.test.ts").toBeTypeOf('string');
		for (const file of readdirSync('tests/browser').filter((f) => f.endsWith('.ts'))) {
			expect(matchesGlob(file, testMatch as string), file).toBe(file.endsWith('.spec.ts'));
		}
	});
});
