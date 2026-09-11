import type { PairingPlanEntry } from '$api/service';
import { matchesFilter, type EntryFilter } from './entryStatus';

/**
 * Which review rows an action is about.
 *
 * A plan's rows are worked in sets, not one at a time: a first sync leaves every row needing a
 * look (I80), and the rows needing the same look are the same handful of problems repeated. This
 * holds the chosen set and nothing else, so the grouping (B247) and the actions over it (B248)
 * have one answer to "which rows" rather than one each.
 *
 * Entries are held by `stream_id`, which is what the plan keys a row by everywhere else, so a
 * selection survives the entry objects being replaced by a reload.
 */
export type Selection = ReadonlySet<string>;

export const emptySelection: Selection = new Set<string>();

export function isSelected(selection: Selection, entry: PairingPlanEntry): boolean {
	return selection.has(entry.stream_id);
}

export function selectedCount(selection: Selection): number {
	return selection.size;
}

/** Add or remove one row, whichever it is not. */
export function toggle(selection: Selection, entry: PairingPlanEntry): Selection {
	const next = new Set(selection);
	if (!next.delete(entry.stream_id)) next.add(entry.stream_id);
	return next;
}

/** The rows a filter admits, which is what a select-all acts on. */
export function entriesInFilter(
	entries: PairingPlanEntry[],
	filter: EntryFilter
): PairingPlanEntry[] {
	return entries.filter((entry) => matchesFilter(entry, filter));
}

/**
 * Select every row the filter admits, keeping whatever was selected outside it.
 *
 * Outside the filter is left alone deliberately: an operator who selects all of "needs checking",
 * switches to "with warnings" and selects all of that has chosen both sets, and dropping the first
 * would make the filter a destructive control.
 */
export function selectAllInFilter(
	selection: Selection,
	entries: PairingPlanEntry[],
	filter: EntryFilter
): Selection {
	const next = new Set(selection);
	for (const entry of entriesInFilter(entries, filter)) next.add(entry.stream_id);
	return next;
}

/** Drop every row the filter admits, keeping the rest. The counterpart of [`selectAllInFilter`]. */
export function clearFilterFromSelection(
	selection: Selection,
	entries: PairingPlanEntry[],
	filter: EntryFilter
): Selection {
	const next = new Set(selection);
	for (const entry of entriesInFilter(entries, filter)) next.delete(entry.stream_id);
	return next;
}

export function clearSelection(): Selection {
	return new Set<string>();
}

/**
 * What the header checkbox shows: every row in the filter selected, some of them, or none.
 *
 * An empty filter is `none`, not `all`: a checkbox that reads as ticked over nothing invites a
 * click that does nothing.
 */
export function filterSelectionState(
	selection: Selection,
	entries: PairingPlanEntry[],
	filter: EntryFilter
): 'none' | 'some' | 'all' {
	const inFilter = entriesInFilter(entries, filter);
	if (inFilter.length === 0) return 'none';
	const selected = inFilter.filter((entry) => selection.has(entry.stream_id)).length;
	if (selected === 0) return 'none';
	return selected === inFilter.length ? 'all' : 'some';
}

/**
 * The selection, less any row the plan no longer carries.
 *
 * A reload replaces the entries, and a row that went away must not keep a bulk action pointed at
 * it. Called wherever the plan's entries are refreshed.
 */
export function prune(selection: Selection, entries: PairingPlanEntry[]): Selection {
	const live = new Set(entries.map((entry) => entry.stream_id));
	return new Set([...selection].filter((id) => live.has(id)));
}

/** The chosen rows, in the order the plan lists them rather than the order they were clicked. */
export function selectedEntries(
	selection: Selection,
	entries: PairingPlanEntry[]
): PairingPlanEntry[] {
	return entries.filter((entry) => selection.has(entry.stream_id));
}

/** Add these rows to the selection, leaving the rest of it alone. */
export function selectEntries(selection: Selection, entries: PairingPlanEntry[]): Selection {
	const next = new Set(selection);
	for (const entry of entries) next.add(entry.stream_id);
	return next;
}
