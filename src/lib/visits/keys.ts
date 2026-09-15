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

/**
 * Where a keystroke leaves the selection, or `null` when there is nowhere to go and the cell's own
 * input should keep the key.
 *
 * The grid is ragged and filtered, so a coordinate is not a destination: `navigable` answers for
 * each one, and the search walks past a computed row, a cell beyond its own row's replicates and a
 * row the parameter-group filter hides. Arrows move by one such cell, Enter moves down the way a
 * technician reads an analyser's output, and Tab runs the grid in row-major order so it wraps to
 * the next row's first replicate rather than into the statistics; `shift` reverses Tab and extends
 * an arrow's selection instead of moving it.
 */
export function nextCell(
	selection: Selection,
	key: GridKey,
	dimensions: Dimensions,
	navigable: (row: number, column: number) => boolean,
	shift = false,
): Selection | null {
	const { rows, columns } = dimensions;
	if (rows < 1 || columns < 1) return null;

	if (key === 'Tab') {
		const step = shift ? -1 : 1;
		const last = rows * columns;
		for (let index = selection.row * columns + selection.column + step; index >= 0 && index < last; index += step) {
			const row = Math.floor(index / columns);
			const column = index % columns;
			if (navigable(row, column)) return at(row, column);
		}
		return null;
	}

	const step: Record<Exclude<GridKey, 'Tab'>, [number, number]> = {
		ArrowUp: [-1, 0],
		ArrowDown: [1, 0],
		ArrowLeft: [0, -1],
		ArrowRight: [0, 1],
		Enter: [1, 0],
	};
	const [dy, dx] = step[key];
	let row = selection.row + dy;
	let column = selection.column + dx;
	while (row >= 0 && row < rows && column >= 0 && column < columns) {
		if (navigable(row, column)) {
			return shift && key !== 'Enter' ? { ...selection, row, column } : at(row, column);
		}
		row += dy;
		column += dx;
	}
	return null;
}

/** The rectangle a selection stands on, read from its top left corner. */
export interface Bounds {
	row: number;
	column: number;
	height: number;
	width: number;
}

/** Where a selection starts and how far it reaches, whichever corner the head ended up in. */
export function bounds(selection: Selection): Bounds {
	const row = Math.min(selection.row, selection.anchorRow);
	const column = Math.min(selection.column, selection.anchorColumn);
	return {
		row,
		column,
		height: Math.max(selection.row, selection.anchorRow) - row + 1,
		width: Math.max(selection.column, selection.anchorColumn) - column + 1,
	};
}

/** The cells a selection covers, in row-major order. One cell unless an extension widened it. */
export function selectedCells(selection: Selection): { row: number; column: number }[] {
	const { row: rowFrom, column: columnFrom, height, width } = bounds(selection);
	const cells = [];
	for (let row = rowFrom; row < rowFrom + height; row += 1) {
		for (let column = columnFrom; column < columnFrom + width; column += 1) {
			cells.push({ row, column });
		}
	}
	return cells;
}

/** Whether a cell is inside the selection, which is what the grid shades. */
export function covers(selection: Selection, row: number, column: number): boolean {
	const b = bounds(selection);
	return (
		row >= b.row && row < b.row + b.height && column >= b.column && column < b.column + b.width
	);
}

/**
 * Where a cell's focus event leaves the selection. A keyboard move focuses its destination, so a
 * focus landing on the head keeps the extension that move built; a focus anywhere else came from
 * the pointer or from Tab out of the grid and stands on that cell alone.
 */
export function onFocusMoved(selection: Selection | null, row: number, column: number): Selection {
	if (selection && selection.row === row && selection.column === column) return selection;
	return at(row, column);
}
