import { describe, expect, it } from 'vitest';

import type { PairingPlanEntry } from '$api/service';
import { acceptedKeys, entriesSettledBy, objectDecisions, objectKeys } from './objectDecisions';

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

	it('leaves a row carrying its own warning to be read, whatever is accepted', () => {
		const warned = site('FP1', {
			warnings: [{ kind: 'units_mismatch', message: 'mm vs m' }],
		} as Partial<PairingPlanEntry>);
		expect(entriesSettledBy([warned], 'site:FP1', new Set(['project:CNET']))).toEqual([]);
	});

	it('reads an object as accepted once the rows it alone held are ticked', () => {
		const entries = [
			entry({ project: { id: 'p', name: 'CNET', create: false }, acknowledged: true } as Partial<PairingPlanEntry>),
			entry({ project: { id: 'p', name: 'CNET', create: false } }),
		];
		expect(acceptedKeys(objectDecisions(entries))).toEqual(new Set());
		entries[1]!.acknowledged = true;
		expect(acceptedKeys(objectDecisions(entries))).toEqual(new Set(['site:FP1']));
	});

	it('counts skipped rows against no decision', () => {
		expect(objectDecisions([site('FP1', { action: 'skip' })])).toEqual([]);
	});
});
