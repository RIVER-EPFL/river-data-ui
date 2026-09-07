// Moving around the entry grid without the mouse (M118). The grid is a matrix of replicate cells,
// parameters down and replicates across; the statistics columns beside them are read-only and are
// never a destination, so Tab wraps past them to the next row's first replicate. Everything here
// is pure over the selection and the grid's dimensions, so the page is its only caller.

export interface Dimensions {
	rows: number;
	columns: number;
}

/** Where the keyboard is, and what it has extended over. The anchor is where extension began. */
export interface Selection {
	row: number;
	column: number;
	anchorRow: number;
	anchorColumn: number;
}

/** A selection of exactly one cell. */
export function at(row: number, column: number): Selection {
	return { row, column, anchorRow: row, anchorColumn: column };
}

/** The keys the grid answers to. Anything else is left to the input under the cursor. */
export type GridKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Enter' | 'Tab';

const KEYS: GridKey[] = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Tab'];

export function isGridKey(key: string): key is GridKey {
	return (KEYS as string[]).includes(key);
}

function clamp(value: number, limit: number): number {
	return Math.max(0, Math.min(value, limit - 1));
}

/**
 * Where a keystroke leaves the selection, or `null` when the grid does not answer to it and the
 * cell's own input should have it.
 *
 * Arrows move by one and stop at the edges. Enter moves down, the way a technician reads an
 * analyser's output. Tab moves right and wraps to the next row's first replicate rather than into
 * the statistics; `shift` reverses Tab and extends an arrow's selection instead of moving it.
 */
export function move(
	selection: Selection,
	key: GridKey,
	dimensions: Dimensions,
	shift = false,
): Selection | null {
	const { rows, columns } = dimensions;
	if (rows < 1 || columns < 1) return null;

	if (key === 'Tab') {
		const forward = !shift;
		const index = selection.row * columns + selection.column + (forward ? 1 : -1);
		if (index < 0 || index >= rows * columns) return null;
		return at(Math.floor(index / columns), index % columns);
	}

	const step: Record<Exclude<GridKey, 'Tab'>, [number, number]> = {
		ArrowUp: [-1, 0],
		ArrowDown: [1, 0],
		ArrowLeft: [0, -1],
		ArrowRight: [0, 1],
		Enter: [1, 0],
	};
	const [dy, dx] = step[key];
	const row = clamp(selection.row + dy, rows);
	const column = clamp(selection.column + dx, columns);
	if (shift && key !== 'Enter') {
		return { ...selection, row, column };
	}
	return at(row, column);
}

/** The cells a selection covers, in row-major order. One cell unless an extension widened it. */
export function selectedCells(selection: Selection): { row: number; column: number }[] {
	const rowFrom = Math.min(selection.row, selection.anchorRow);
	const rowTo = Math.max(selection.row, selection.anchorRow);
	const columnFrom = Math.min(selection.column, selection.anchorColumn);
	const columnTo = Math.max(selection.column, selection.anchorColumn);
	const cells = [];
	for (let row = rowFrom; row <= rowTo; row += 1) {
		for (let column = columnFrom; column <= columnTo; column += 1) {
			cells.push({ row, column });
		}
	}
	return cells;
}

/** Whether a cell is inside the selection, which is what the grid shades. */
export function covers(selection: Selection, row: number, column: number): boolean {
	return (
		row >= Math.min(selection.row, selection.anchorRow) &&
		row <= Math.max(selection.row, selection.anchorRow) &&
		column >= Math.min(selection.column, selection.anchorColumn) &&
		column <= Math.max(selection.column, selection.anchorColumn)
	);
}
