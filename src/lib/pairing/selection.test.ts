import { describe, expect, it } from 'vitest';

import type { PairingPlanEntry } from '$api/service';
import {
	clearFilterFromSelection,
	emptySelection,
	filterSelectionState,
	isSelected,
	prune,
	selectAllInFilter,
	selectedEntries,
	toggle,
} from './selection';

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

/** Matched, no warnings, unticked: self-validated. */
const clean = (id: string) => entry({ stream_id: id });
/** A warning and no tick: needs checking. */
const flagged = (id: string) =>
	entry({ stream_id: id, warnings: [{ kind: 'units_differ', message: 'units differ' }] });

describe('pairing selection', () => {
	it('toggles one row on and off again', () => {
		const one = toggle(emptySelection, clean('a'));
		expect(isSelected(one, clean('a'))).toBe(true);
		expect(isSelected(toggle(one, clean('a')), clean('a'))).toBe(false);
	});

	it('holds a row by its stream id, so a reloaded entry object is still selected', () => {
		const selection = toggle(emptySelection, clean('a'));
		// A reload builds new objects for the same rows.
		expect(isSelected(selection, entry({ stream_id: 'a', action: 'skip' }))).toBe(true);
	});

	it('selects every row the filter admits and no other', () => {
		const entries = [clean('a'), flagged('b'), flagged('c')];
		const selection = selectAllInFilter(emptySelection, entries, 'needs_checking');
		expect([...selection].sort()).toEqual(['b', 'c']);
	});

	// Switching filter and selecting again is two choices, not a replacement of the first.
	it('keeps what was selected outside the filter', () => {
		const entries = [clean('a'), flagged('b')];
		const first = selectAllInFilter(emptySelection, entries, 'self_validated');
		const second = selectAllInFilter(first, entries, 'needs_checking');
		expect([...second].sort()).toEqual(['a', 'b']);
	});

	it('clears only the filter it is given', () => {
		const entries = [clean('a'), flagged('b')];
		const both = selectAllInFilter(emptySelection, entries, 'all');
		const left = clearFilterFromSelection(both, entries, 'needs_checking');
		expect([...left]).toEqual(['a']);
	});

	it('reports the header checkbox as none, some or all', () => {
		const entries = [flagged('b'), flagged('c')];
		expect(filterSelectionState(emptySelection, entries, 'needs_checking')).toBe('none');
		const one = toggle(emptySelection, flagged('b'));
		expect(filterSelectionState(one, entries, 'needs_checking')).toBe('some');
		const all = selectAllInFilter(emptySelection, entries, 'needs_checking');
		expect(filterSelectionState(all, entries, 'needs_checking')).toBe('all');
	});

	// A ticked box over nothing invites a click that does nothing.
	it('reports an empty filter as none rather than all', () => {
		expect(filterSelectionState(emptySelection, [clean('a')], 'needs_checking')).toBe('none');
	});

	it('drops a row the plan no longer carries', () => {
		const selection = selectAllInFilter(emptySelection, [clean('a'), clean('b')], 'all');
		expect([...prune(selection, [clean('a')])]).toEqual(['a']);
	});

	it('returns the chosen rows in the plan order, not the click order', () => {
		const entries = [clean('a'), clean('b'), clean('c')];
		let selection = toggle(emptySelection, clean('c'));
		selection = toggle(selection, clean('a'));
		expect(selectedEntries(selection, entries).map((e) => e.stream_id)).toEqual(['a', 'c']);
	});
});

describe('selecting a decision group', () => {
	it('adds the group and keeps the rest of the selection', async () => {
		const { selectEntries } = await import('./selection');
		const already = toggle(emptySelection, clean('z'));
		const selection = selectEntries(already, [clean('a'), clean('b')]);
		expect([...selection].sort()).toEqual(['a', 'b', 'z']);
	});
});
