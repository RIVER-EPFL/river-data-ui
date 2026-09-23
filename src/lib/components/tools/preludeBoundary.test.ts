import { describe, expect, it } from 'vitest';

import { describeScript } from './preludeBoundary';

const carried = [
	'# Source: cnet-data-portal (MIT, mclement18)',
	'calcMean <- function(x) {',
	'  mean(x)',
	'}',
	'',
	'tool <- function(inputs, constants, curves) list(avg = calcMean(inputs$x))',
].join('\n');

describe('describeScript', () => {
	it('ends the prelude after the last carried block and the blank line under it', () => {
		const structure = describeScript(carried, 'tool');
		// The newline closing the blank line under `}`.
		expect(structure.preludeEnd).toBe(carried.indexOf('}\n\ntool') + 2);
		expect(carried.slice(0, structure.preludeEnd!)).toMatch(/\}\n$/);
		expect(structure.preludeLines).toBe(5);
		expect(structure.entryLine).toBe(6);
		expect(structure.authoredLines).toBe(1);
	});

	it('reports no prelude for a script that does not open with the marker', () => {
		const script = `# DOC\n${carried}`;
		const structure = describeScript(script, 'tool');
		expect(structure.preludeEnd).toBeNull();
		expect(structure.preludeLines).toBe(0);
		expect(structure.authoredLines).toBe(structure.totalLines);
	});
});
