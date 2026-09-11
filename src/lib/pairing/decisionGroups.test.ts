import { describe, expect, it } from 'vitest';

import type { PairingPlanEntry } from '$api/service';
import {
	decisionGroups,
	decisionLabel,
	decisionReasons,
	decisionScopeLabel,
} from './decisionGroups';

function entry(over: Partial<PairingPlanEntry> = {}): PairingPlanEntry {
	return {
		stream_id: 'stream',
		source_key: 'STA:Depth',
		source_name: null,
		action: 'pair',
		project: { id: 'p', name: 'BREATHE', create: false },
		site: { id: 's', name: 'Martigny', create: false, latitude: null, longitude: null, altitude_m: null },
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

const newSite = (id: string, site = 'Saxon') =>
	entry({
		stream_id: id,
		site: { id: null, name: site, create: true, latitude: null, longitude: null, altitude_m: null },
	} as Partial<PairingPlanEntry>);

const unitsDiffer = (id: string) =>
	entry({
		stream_id: id,
		warnings: [{ kind: 'units_mismatch', message: 'mm vs m' }],
	});

describe('pairing decision groups', () => {
	it('reads what one entry is waiting on', () => {
		expect(decisionReasons(newSite('a'))).toEqual(['new site']);
		expect(decisionReasons(unitsDiffer('a'))).toEqual(['units_mismatch']);
	});

	// The kind is the question; the message names the row and would split every group into ones.
	it('groups on the warning kind, not its message', () => {
		const entries = [
			entry({ stream_id: 'a', warnings: [{ kind: 'units_mismatch', message: 'mm vs m' }] }),
			entry({ stream_id: 'b', warnings: [{ kind: 'units_mismatch', message: 'C vs K' }] }),
		];
		const groups = decisionGroups(entries);
		expect(groups).toHaveLength(1);
		expect(groups[0].entries).toHaveLength(2);
	});

	it('puts the biggest group first, because one decision buys the most there', () => {
		const entries = [newSite('a'), newSite('b'), newSite('c'), unitsDiffer('d')];
		const groups = decisionGroups(entries);
		expect(groups.map((g) => g.entries.length)).toEqual([3, 1]);
		expect(groups[0].label).toBe('new site');
	});

	it('leaves a self-validated row out: it asks nothing', () => {
		expect(decisionGroups([entry({ stream_id: 'clean' })])).toEqual([]);
	});

	it('leaves an acknowledged row out: it has been answered', () => {
		const answered = entry({ stream_id: 'a', acknowledged: true, warnings: [{ kind: 'units_mismatch', message: 'mm vs m' }] });
		expect(decisionGroups([answered])).toEqual([]);
	});

	// Two entries waiting on the same two things are one question, however the fields are ordered.
	it('keys a combined question the same way whatever order the reasons arrive in', () => {
		const a = entry({
			stream_id: 'a',
			site: { id: null, name: 'Saxon', create: true, latitude: null, longitude: null, altitude_m: null },
			warnings: [{ kind: 'units_mismatch', message: 'x' }],
		} as Partial<PairingPlanEntry>);
		const b = entry({
			stream_id: 'b',
			warnings: [{ kind: 'units_mismatch', message: 'y' }],
			site: { id: null, name: 'Saxon', create: true, latitude: null, longitude: null, altitude_m: null },
		} as Partial<PairingPlanEntry>);
		expect(decisionGroups([a, b])).toHaveLength(1);
	});

	it('says how far a group reaches', () => {
		const groups = decisionGroups([newSite('a', 'Saxon'), newSite('b', 'Verbier')]);
		expect(decisionScopeLabel(groups[0])).toBe('2 streams at 2 sites');
		expect(decisionScopeLabel(decisionGroups([newSite('a')])[0])).toBe('1 stream');
	});

	it('renders a label a person can read', () => {
		expect(decisionLabel(['new site', 'units_mismatch'])).toBe('new site, units mismatch');
	});
});
