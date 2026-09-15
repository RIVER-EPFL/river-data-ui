import { describe, expect, it } from 'vitest';

import { at, bounds, covers, isGridKey, nextCell, onFocusMoved, selectedCells } from './keys';

const grid = { rows: 3, columns: 4 };
const everywhere = () => true;

// A grid where the keyboard has somewhere to go and somewhere it must not: row 1 is a calculation's
// output and renders no input at all, row 2 holds one replicate and a trailing empty cell, and the
// parameter-group filter has hidden row 3.
const ragged = { rows: 4, columns: 4 };
const raggedCells = (row: number, column: number) =>
	row === 0 ? true : row === 2 ? column <= 1 : false;

const move = (
	selection: Parameters<typeof nextCell>[0],
	key: Parameters<typeof nextCell>[1],
	dimensions: Parameters<typeof nextCell>[2],
	shift = false,
) => nextCell(selection, key, dimensions, everywhere, shift);

describe('moving around the entry grid', () => {
	it('moves by one and stops at the edges', () => {
		expect(move(at(1, 1), 'ArrowRight', grid)).toEqual(at(1, 2));
		expect(move(at(1, 1), 'ArrowUp', grid)).toEqual(at(0, 1));
		expect(move(at(0, 0), 'ArrowUp', grid)).toBeNull();
		expect(move(at(2, 3), 'ArrowDown', grid)).toBeNull();
	});

	it('moves down on Enter, the way an analyser is read', () => {
		expect(move(at(0, 2), 'Enter', grid)).toEqual(at(1, 2));
	});

	it('wraps Tab past the statistics to the next row rather than into them', () => {
		expect(move(at(0, 3), 'Tab', grid)).toEqual(at(1, 0));
		expect(move(at(1, 0), 'Tab', grid, true)).toEqual(at(0, 3));
	});

	it('leaves the last cell to the page', () => {
		expect(move(at(2, 3), 'Tab', grid)).toBeNull();
		expect(move(at(0, 0), 'Tab', grid, true)).toBeNull();
	});

	it('extends rather than moves when shift is held', () => {
		const extended = move(at(1, 1), 'ArrowRight', grid, true)!;
		expect(extended.anchorRow).toBe(1);
		expect(extended.anchorColumn).toBe(1);
		expect(selectedCells(extended)).toEqual([
			{ row: 1, column: 1 },
			{ row: 1, column: 2 },
		]);
	});

	it('covers every cell between the anchor and the head, in either direction', () => {
		const upward = { row: 0, column: 1, anchorRow: 2, anchorColumn: 2 };
		expect(selectedCells(upward)).toHaveLength(6);
		expect(covers(upward, 1, 2)).toBe(true);
		expect(covers(upward, 1, 0)).toBe(false);
	});

	it('steps over a cell that renders no input, and over a row the filter hides', () => {
		expect(nextCell(at(0, 0), 'Tab', ragged, raggedCells)).toEqual(at(0, 1));
		// Past row 0's last cell, over the whole of the computed row 1, into row 2.
		expect(nextCell(at(0, 3), 'Tab', ragged, raggedCells)).toEqual(at(2, 0));
		// Row 2 ends at its own width, and row 3 is hidden, so there is nowhere further.
		expect(nextCell(at(2, 1), 'Tab', ragged, raggedCells)).toBeNull();
		// Down from row 0 crosses the computed row rather than landing on it.
		expect(nextCell(at(0, 1), 'ArrowDown', ragged, raggedCells)).toEqual(at(2, 1));
		expect(nextCell(at(0, 2), 'ArrowDown', ragged, raggedCells)).toBeNull();
	});

	it('extends over the cells it can land on, keeping the anchor', () => {
		const extended = nextCell(at(0, 1), 'ArrowDown', ragged, raggedCells, true)!;
		expect(extended).toEqual({ row: 2, column: 1, anchorRow: 0, anchorColumn: 1 });
	});

	it('keeps an extension when the focus lands on the head the keyboard just moved to', () => {
		const extended = move(at(1, 1), 'ArrowRight', grid, true)!;
		expect(onFocusMoved(extended, extended.row, extended.column)).toEqual(extended);
	});

	it('collapses to one cell when the focus lands anywhere else', () => {
		const extended = move(at(1, 1), 'ArrowRight', grid, true)!;
		expect(onFocusMoved(extended, 2, 0)).toEqual(at(2, 0));
		expect(onFocusMoved(null, 0, 3)).toEqual(at(0, 3));
	});

	it('answers only to the keys the grid owns', () => {
		expect(isGridKey('ArrowLeft')).toBe(true);
		expect(isGridKey('a')).toBe(false);
	});

	it('has nowhere to go in an empty grid', () => {
		expect(nextCell(at(0, 0), 'ArrowDown', { rows: 0, columns: 0 }, everywhere)).toBeNull();
	});

	it('is a rectangle read from its top left, whichever corner the head is in', () => {
		expect(bounds(at(2, 1))).toEqual({ row: 2, column: 1, height: 1, width: 1 });
		expect(bounds({ row: 0, column: 1, anchorRow: 2, anchorColumn: 2 })).toEqual({
			row: 0,
			column: 1,
			height: 3,
			width: 2,
		});
	});
});
