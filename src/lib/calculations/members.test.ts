import { describe, expect, it } from 'vitest';

import type { Parameter, ParameterGroupMember } from '$api/crud';
import { portalReference, referenceOrigin, referenceText, replicatedCodes } from './members';

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
			{ code: 'SUVA', function: 'calcSUVA', inputs: ['DOC', 'a254'], sourceSystem: null, column: null },
		]);
	});

	it('carries the system and the column the source computed into', () => {
		const members = [
			member('p2', {
				source_calculation: { function: 'calcSUVA', inputs: ['DOC'], source_system: 'cnet', column: 'SUVA_254' },
			}),
		];
		expect(portalReference(members, parameters, ['SUVA'])).toEqual([
			{ code: 'SUVA', function: 'calcSUVA', inputs: ['DOC'], sourceSystem: 'cnet', column: 'SUVA_254' },
		]);
	});

	it('leaves out a member the source computed with nothing', () => {
		const members = [member('p1', { source_calculation: { inputs: ['x'] } }), member('p2')];
		expect(portalReference(members, parameters, ['DOC', 'SUVA'])).toEqual([]);
	});
});

const unplaced = { sourceSystem: null, column: null };

describe('how a recorded portal calculation reads', () => {
	it('says a replicate mean is only the mean of the portal columns', () => {
		const recorded = { code: 'CO2_HS_Um', function: 'calcMean', inputs: ['CO2_HS_Um_A', 'CO2_HS_Um_B'], ...unplaced };
		expect(referenceText(recorded)).toBe("the portal's mean of its CO2_HS_Um_A and CO2_HS_Um_B columns");
	});

	it('says a replicate sd is only the sd of the portal columns', () => {
		const recorded = { code: 'DOC_sd', function: 'calcSd', inputs: ['DOC_1', 'DOC_2', 'DOC_3'], ...unplaced };
		expect(referenceText(recorded)).toBe("the portal's standard deviation of its DOC_1, DOC_2 and DOC_3 columns");
	});

	it('writes any other function as the call the portal made', () => {
		const recorded = { code: 'SUVA', function: 'calcSUVA', inputs: ['DOC', 'a254'], ...unplaced };
		expect(referenceText(recorded)).toBe('calcSUVA(DOC, a254)');
	});
});

describe('where a recorded portal calculation came from', () => {
	it('names the portal and its column', () => {
		const recorded = { code: 'SUVA', function: 'calcSUVA', inputs: [], sourceSystem: 'cnet', column: 'SUVA_254' };
		expect(referenceOrigin(recorded)).toBe('CNET column SUVA_254');
	});

	it('names what it has of the two', () => {
		const base = { code: 'SUVA', function: 'calcSUVA', inputs: [] };
		expect(referenceOrigin({ ...base, sourceSystem: 'cnet', column: null })).toBe('CNET');
		expect(referenceOrigin({ ...base, sourceSystem: null, column: 'SUVA_254' })).toBe('column SUVA_254');
		expect(referenceOrigin({ ...base, sourceSystem: null, column: null })).toBe(null);
	});
});
