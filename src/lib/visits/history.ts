// Undo for the entry grid (M117). Every edit replaces the row array wholesale, so the value that
// was replaced is the snapshot, and a bounded stack of them is the whole model.

/** How many edits back the grid can go. A pasted block plus the corrections after it, comfortably. */
export const HISTORY_LIMIT = 50;

/** Snapshots of what the grid held before each edit, oldest first. */
export type History<T> = readonly T[];

/** Record what the grid held before an edit. The oldest snapshot falls off at the limit. */
export function push<T>(history: History<T>, snapshot: T, limit = HISTORY_LIMIT): History<T> {
	return [...history, snapshot].slice(-limit);
}

/** The state before the last edit, and the history without it. `null` when there is nothing to undo. */
export function undo<T>(history: History<T>): { history: History<T>; value: T } | null {
	if (history.length === 0) return null;
	return { history: history.slice(0, -1), value: history[history.length - 1] };
}

/** No snapshots. What is on the server is not an edit the grid can take back. */
export function empty<T>(): History<T> {
	return [];
}
