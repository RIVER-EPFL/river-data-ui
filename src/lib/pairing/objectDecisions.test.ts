import { describe, expect, it } from 'vitest';

import type { PairingPlanEntry } from '$api/service';
import { objectDecisions, objectKey } from './objectDecisions';

function entry(over: Partial<PairingPlanEntry> = {}): PairingPlanEntry {
	return {
		stream_id: 'stream',
		source_key: 'STA:Depth',
		source_name: null,
		action: 'pair',
		project: { id: null, name: 'CNET', create: true },
		site: { id: null, name: 'FP1', create: true, latitude: null, longitude: null, altitude_m: null },
		parameter: {
			id: 'par',
			name: 'Depth',
			label: null,
			create: false,
			units: 'mm',
			group_key: null,
			original_names: [], attach: null,
		},
		confidence: 'exact',
		warnings: [],
		original_parameter_name: null,
		replicates: null,
		instrument: null,
		...over,
	} as PairingPlanEntry;
}

const site = (name: string, over: Partial<PairingPlanEntry> = {}) =>
	entry({
		site: { id: null, name, create: true, latitude: null, longitude: null, altitude_m: null },
		...over,
	});

describe('objectDecisions', () => {
	it('keys a project and a parameter by name', () => {
		expect(objectKey('project', entry())).toBe('project:CNET');
		expect(objectKey('parameter', entry())).toBe('parameter:Depth');
	});

	it('collapses rows into the projects behind them, counting their sites', () => {
		const [cnet] = objectDecisions([site('FP1'), site('FP1'), site('FP3')], 'project');
		expect(cnet).toMatchObject({ key: 'project:CNET', create: true, entryCount: 3, siteCount: 2, reviewed: false });
	});

	it('lists an existing parameter as well as a created one', () => {
		const created = site('FP1', {
			parameter: { id: null, name: 'DOC', label: null, create: true, units: 'ppb', group_key: null, group: null, calculation: null, original_names: [], attach: null },
		} as Partial<PairingPlanEntry>);
		const decisions = objectDecisions([site('FP1'), created], 'parameter');
		expect(decisions.map((d) => [d.name, d.create])).toEqual([
			['Depth', false],
			['DOC', true],
		]);
	});

	it('reads a review from the plan and orders the open ones first', () => {
		const other = site('FP2', { project: { id: 'p', name: 'METALP', create: false } });
		const decisions = objectDecisions([site('FP1'), site('FP1'), other], 'project', ['project:CNET']);
		expect(decisions.map((d) => [d.name, d.reviewed])).toEqual([
			['METALP', false],
			['CNET', true],
		]);
	});

	it('counts skipped rows against nothing', () => {
		expect(objectDecisions([site('FP1', { action: 'skip' })], 'project')).toEqual([]);
	});
});
