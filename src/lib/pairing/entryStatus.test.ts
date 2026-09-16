import { describe, expect, it } from 'vitest';

import type { PairingPlanEntry } from '$api/service';
import {
	entryStatus,
	matchesFilter,
	reviewState,
	statusLabel,
} from './entryStatus';

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

describe('pairing entry status', () => {
	it('reads an entry whose project, site and parameter all resolve as matched', () => {
		const status = entryStatus(entry());
		expect(status.matched).toBe(true);
		expect(status.creates).toEqual([]);
		expect(statusLabel(status)).toBe('matched');
	});

	it('names each entity the plan will create, in row order', () => {
		const status = entryStatus(
			entry({
				project: { id: null, name: 'CNET', create: true },
				site: { id: null, name: 'FP1', create: true, latitude: null, longitude: null, altitude_m: null },
			}),
		);
		expect(status.matched).toBe(false);
		expect(status.creates).toEqual(['project', 'site']);
		expect(statusLabel(status)).toBe('new project, site');
	});

	it('counts warnings and reports each kind once', () => {
		const status = entryStatus(
			entry({
				warnings: [
					{ kind: 'units_mismatch', message: 'a' },
					{ kind: 'units_mismatch', message: 'b' },
					{ kind: 'near_duplicate', message: 'c' },
				],
			} as Partial<PairingPlanEntry>),
		);
		expect(status.warnings).toBe(3);
		expect(status.warningKinds).toEqual(['units_mismatch', 'near_duplicate']);
	});

	it('holds an entry that resolves nothing and creates nothing as unresolved, not matched', () => {
		const status = entryStatus(
			entry({
				action: 'skip',
				site: { id: null, name: '', create: false, latitude: null, longitude: null, altitude_m: null },
			}),
		);
		expect(status.matched).toBe(false);
		expect(statusLabel(status)).toBe('unresolved');
		expect(status.action).toBe('skip');
	});

	it('selects the same set for each filter as the legend it renders', () => {
		const matched = entry();
		const unmatched = entry({
			parameter: {
				id: null,
				name: 'New',
				label: null,
				create: true,
				units: 'mm',
				group_key: null,
				group: null,
				calculation: null,
				original_names: [],
			},
		});
		const skipped = entry({ action: 'skip' });
		const warned = entry({ warnings: [{ kind: 'units_mismatch', message: 'a' }] } as Partial<PairingPlanEntry>);

		expect([matched, unmatched, skipped, warned].filter((e) => matchesFilter(e, 'all'))).toHaveLength(4);
		expect([matched, unmatched, skipped, warned].filter((e) => matchesFilter(e, 'unmatched'))).toEqual([unmatched]);
		expect([matched, unmatched, skipped, warned].filter((e) => matchesFilter(e, 'warnings'))).toEqual([warned]);
		expect([matched, unmatched, skipped, warned].filter((e) => matchesFilter(e, 'skip'))).toEqual([skipped]);
		expect([matched, unmatched, skipped, warned].filter((e) => matchesFilter(e, 'pair'))).toHaveLength(3);
	});
});

describe('pairing review state', () => {
	it('leaves a fully matched entry with no warning waiting on nobody', () => {
		expect(reviewState(entry())).toBe('self_validated');
	});

	it('asks about an entry that did not resolve, or that warned', () => {
		expect(reviewState(entry({ site: { id: null, name: 'New', create: true, latitude: null, longitude: null, altitude_m: null } }))).toBe(
			'needs_checking',
		);
		expect(
			reviewState(
				entry({ warnings: [{ kind: 'units_mismatch', message: 'mm vs m' }] } as Partial<PairingPlanEntry>),
			),
		).toBe('needs_checking');
	});

	it('settles an entry once a person has ticked it, whatever its evidence said', () => {
		expect(
			reviewState(
				entry({
					acknowledged: true,
					warnings: [{ kind: 'units_mismatch', message: 'mm vs m' }],
				} as Partial<PairingPlanEntry>),
			),
		).toBe('acknowledged');
	});

	it('filters on the same predicate the badge reads', () => {
		const warned = entry({
			warnings: [{ kind: 'units_mismatch', message: 'mm vs m' }],
		} as Partial<PairingPlanEntry>);
		expect(matchesFilter(warned, 'needs_checking')).toBe(true);
		expect(matchesFilter(warned, 'self_validated')).toBe(false);
		expect(matchesFilter(entry(), 'self_validated')).toBe(true);
		expect(matchesFilter(entry({ acknowledged: true }), 'needs_checking')).toBe(false);
	});
});
