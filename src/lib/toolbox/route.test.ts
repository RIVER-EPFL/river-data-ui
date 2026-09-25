import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '$api/client';

import type { ToolScriptSummary } from '$api/service';
import { manageToolsRedirect } from './redirect';
import { calculationHref, findCalculation, resolveCalculation, toolboxHref } from './route';

const script = (id: string, name: string, engine: 'formula' | 'script') =>
	({ id, name, label: name, engine }) as unknown as ToolScriptSummary;

describe('the toolbox route', () => {
	it('links a calculation by its name, carrying the version when one is named', () => {
		expect(toolboxHref('/app', 'doc')).toBe('/app/toolbox/doc');
		expect(toolboxHref('/app', 'doc', 3)).toBe('/app/toolbox/doc?version=3');
	});

	it('opens a formula on the page of the calculation it belongs to', () => {
		expect(calculationHref('/app', { tool_script_id: 'ts-1' })).toBe('/app/toolbox/ts-1');
	});

	it('opens the calculation on the cell, the run and the replicate a value came from', () => {
		expect(
			calculationHref(
				'/app',
				{ tool_script_id: 'ts-1' },
				{ cell: 'pco2', run: 'run-9', index: 2 },
			),
		).toBe('/app/toolbox/ts-1?cell=pco2&run=run-9&index=2');
	});

	it('leaves a link with nothing to anchor to as it was', () => {
		expect(calculationHref('/app', { tool_script_id: 'ts-1' }, {})).toBe('/app/toolbox/ts-1');
		expect(
			calculationHref('/app', { tool_script_id: 'ts-1' }, { cell: null, run: null, index: null }),
		).toBe('/app/toolbox/ts-1');
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

describe('resolving a /toolbox/[id] segment', () => {
	const id = '0f8fad5b-d9cb-469f-a165-70867728950e';

	it('fetches a calculation by its id', async () => {
		const byId = vi.fn(async () => script(id, 'single', 'formula'));
		const byName = vi.fn(async () => null);
		expect((await resolveCalculation(id, byId, byName))?.name).toBe('single');
		expect(byName).not.toHaveBeenCalled();
	});

	it('finds nothing for an id the API does not hold', async () => {
		const byId = vi.fn(async () => {
			throw new ApiError(404, 'not found');
		});
		expect(await resolveCalculation(id, byId, async () => null)).toBeNull();
	});

	it('asks for a name by name, a provenance blob naming a calculation rather than its id', async () => {
		const byId = vi.fn();
		const byName = vi.fn(async (name: string) => (name === 'doc' ? script('ts-1', 'doc', 'script') : null));
		expect((await resolveCalculation('doc', byId, byName))?.id).toBe('ts-1');
		expect(byName).toHaveBeenCalledWith('doc');
		expect(byId).not.toHaveBeenCalled();
	});
});
