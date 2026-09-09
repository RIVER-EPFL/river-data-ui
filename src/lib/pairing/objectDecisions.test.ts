import { describe, expect, it } from 'vitest';

import type { PairingPlanEntry } from '$api/service';
import {
	acceptHint,
	acceptedKeys,
	entriesSettledBy,
	objectDecisions,
	objectKeys,
} from './objectDecisions';

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
			original_names: [],
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

describe('pairing object decisions', () => {
	it('names the objects one row proposes, in row order', () => {
		expect(objectKeys(entry())).toEqual(['project:CNET', 'site:FP1']);
		expect(objectKeys(entry({ project: { id: 'p', name: 'CNET', create: false } }))).toEqual([
			'site:FP1',
		]);
	});

	it('collapses a thousand rows into the objects behind them', () => {
		const entries = [site('FP1'), site('FP1'), site('FP3')];
		const decisions = objectDecisions(entries);
		expect(decisions.map((d) => d.key)).toEqual(['project:CNET', 'site:FP1', 'site:FP3']);
		expect(decisions[0]?.entryCount).toBe(3);
		expect(decisions.every((d) => !d.accepted)).toBe(true);
	});

	it('settles a row only once every object it names has been accepted', () => {
		const entries = [site('FP1')];
		expect(entriesSettledBy(entries, 'site:FP1', new Set())).toEqual([]);
		expect(entriesSettledBy(entries, 'site:FP1', new Set(['project:CNET']))).toEqual(entries);
	});

	it('never refuses an accept for want of a row to tick', () => {
		const [project] = objectDecisions([site('FP1'), site('FP2')]);
		expect(project?.settles).toBe(0);
		expect(acceptHint(project!)).toContain('Record CNET as accepted');
		expect(acceptHint({ ...project!, accepted: true })).toContain('take that back');
	});

	it('leaves a row carrying its own warning to be read, whatever is accepted', () => {
		const warned = site('FP1', {
			warnings: [{ kind: 'units_mismatch', message: 'mm vs m' }],
		} as Partial<PairingPlanEntry>);
		expect(entriesSettledBy([warned], 'site:FP1', new Set(['project:CNET']))).toEqual([]);
	});

	it('reads an object as accepted from the plan, not from the rows it settles', () => {
		const entries = [entry({ project: { id: 'p', name: 'CNET', create: false } })];
		expect(acceptedKeys(objectDecisions(entries))).toEqual(new Set());
		expect(acceptedKeys(objectDecisions(entries, ['site:FP1']))).toEqual(new Set(['site:FP1']));
	});

	it('offers every object of a first import, where each row creates all three', () => {
		const entries = ['FP1', 'FP2'].flatMap((s) =>
			['DOC', 'Depth'].map((p) =>
				site(s, { parameter: { id: null, name: p, label: null, create: true, units: 'ppb', group_key: null, group: null, original_names: [] } } as Partial<PairingPlanEntry>),
			),
		);
		const decisions = objectDecisions(entries);
		expect(decisions).toHaveLength(5);
		expect(decisions.every((d) => !d.accepted)).toBe(true);

		// Accepting in any order records the decision; the rows tick when their last object lands.
		const accepted = new Set<string>();
		for (const key of ['project:CNET', 'site:FP1', 'parameter:DOC']) {
			expect(entriesSettledBy(entries, key, accepted)).toHaveLength(
				key === 'parameter:DOC' ? 1 : 0,
			);
			accepted.add(key);
		}
		expect(objectDecisions(entries, accepted).filter((d) => d.accepted)).toHaveLength(3);
	});

	it('offers Accept as the decision it is, never as the creation the apply makes', () => {
		const [one] = objectDecisions([site('FP1', { project: { id: 'p', name: 'CNET', create: false } })]);
		expect(acceptHint(one!)).toBe('Record FP1 as accepted, and tick the 1 row it completes.');
		const [two] = objectDecisions([
			site('FP1', { project: { id: 'p', name: 'CNET', create: false } }),
			site('FP1', { project: { id: 'p', name: 'CNET', create: false } }),
		]);
		expect(acceptHint(two!)).toBe('Record FP1 as accepted, and tick the 2 rows it completes.');
	});

	it('counts skipped rows against no decision', () => {
		expect(objectDecisions([site('FP1', { action: 'skip' })])).toEqual([]);
	});
});
