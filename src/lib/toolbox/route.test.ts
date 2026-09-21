import { describe, expect, it } from 'vitest';

import type { ToolScriptSummary } from '$api/service';
import { manageToolsRedirect } from './redirect';
import { calculationHref, findCalculation, toolboxHref } from './route';

const script = (id: string, name: string, engine: 'formula' | 'script') =>
	({ id, name, label: name, engine }) as unknown as ToolScriptSummary;

describe('the toolbox route', () => {
	it('links a calculation by its name, carrying the version when one is named', () => {
		expect(toolboxHref('/app', 'doc')).toBe('/app/toolbox/doc');
		expect(toolboxHref('/app', 'doc', 3)).toBe('/app/toolbox/doc?version=3');
	});

	it('opens a formula in the editor of its own kind', () => {
		expect(calculationHref('/app', { definition_id: 'def-1' })).toBe('/app/derived/def-1');
		expect(calculationHref('/app', { definition_id: 'def-1', tool_script_id: 'ts-1' })).toBe(
			'/app/toolbox/ts-1',
		);
	});

	it('opens the calculation on the cell, the run and the replicate a value came from', () => {
		expect(
			calculationHref(
				'/app',
				{ definition_id: 'def-1', tool_script_id: 'ts-1' },
				{ cell: 'pco2', run: 'run-9', index: 2 },
			),
		).toBe('/app/toolbox/ts-1?cell=pco2&run=run-9&index=2');
		expect(calculationHref('/app', { definition_id: 'def-1' }, { cell: 'k1' })).toBe(
			'/app/derived/def-1?cell=k1',
		);
	});

	it('leaves a link with nothing to anchor to as it was', () => {
		expect(calculationHref('/app', { definition_id: 'def-1' }, {})).toBe('/app/derived/def-1');
		expect(
			calculationHref('/app', { definition_id: 'def-1' }, { cell: null, run: null, index: null }),
		).toBe('/app/derived/def-1');
	});

	it('finds a formula calculation and an R script through the same segment', () => {
		const scripts = [script('a1', 'pco2_demo', 'formula'), script('b2', 'doc', 'script')];
		expect(findCalculation(scripts, 'pco2_demo')?.engine).toBe('formula');
		expect(findCalculation(scripts, 'b2')?.engine).toBe('script');
	});

	it('prefers the id when a name happens to equal another calculation id', () => {
		const scripts = [script('doc', 'other', 'formula'), script('b2', 'doc', 'script')];
		expect(findCalculation(scripts, 'doc')?.id).toBe('doc');
	});

	it('finds nothing for a calculation that does not exist', () => {
		expect(findCalculation([script('a1', 'doc', 'script')], 'missing')).toBeNull();
	});
});

describe('a link to the retired Manage Tools page', () => {
	it('lands on the script it named, at the version it named', () => {
		const search = new URLSearchParams('script=doc&version=2');
		expect(manageToolsRedirect('/app', search)).toBe('/app/toolbox/doc?version=2');
	});

	it('lands on the Toolbox when it named no script', () => {
		expect(manageToolsRedirect('/app', new URLSearchParams())).toBe('/app/toolbox');
	});

	it('drops a version that is not a version number', () => {
		const search = new URLSearchParams('script=doc&version=latest');
		expect(manageToolsRedirect('/app', search)).toBe('/app/toolbox/doc');
	});
});
