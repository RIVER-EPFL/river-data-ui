import { describe, expect, it } from 'vitest';

import type { Parameter, ParameterGroupMember } from '$api/crud';
import { portalReference, replicatedCodes } from './members';

const parameter = (id: string, code: string) => ({ id, code }) as Parameter;
const member = (parameter_id: string, over: Partial<ParameterGroupMember> = {}) =>
	({ parameter_id, replicates: null, source_calculation: null, ...over }) as ParameterGroupMember;

const parameters = [parameter('p1', 'DOC'), parameter('p2', 'SUVA'), parameter('p3', 'Field_BP')];

describe('what a parameter group membership says about a parameter', () => {
	it('reads the replicated codes off the member rows that carry a spec', () => {
		const members = [
			member('p1', { replicates: { columns: ['A', 'B'] } }),
			member('p2'),
			member('p3', { replicates: { columns: ['1'] } }),
		];
		expect(replicatedCodes(members, parameters)).toEqual(['DOC', 'Field_BP']);
	});

	it('names the portal calculation only for the codes the calculation reads', () => {
		const members = [
			member('p2', { source_calculation: { function: 'calcSUVA', inputs: ['DOC', 'a254'] } }),
			member('p3', { source_calculation: { function: 'calcAlt2BP', inputs: ['altitude'] } }),
		];
		expect(portalReference(members, parameters, ['SUVA'])).toEqual([
			{ code: 'SUVA', function: 'calcSUVA', inputs: ['DOC', 'a254'] },
		]);
	});

	it('leaves out a member the source computed with nothing', () => {
		const members = [member('p1', { source_calculation: { inputs: ['x'] } }), member('p2')];
		expect(portalReference(members, parameters, ['DOC', 'SUVA'])).toEqual([]);
	});
});
