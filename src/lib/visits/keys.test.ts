import { describe, expect, it } from 'vitest';

import { at, covers, isGridKey, move, selectedCells } from './keys';

const grid = { rows: 3, columns: 4 };

describe('moving around the entry grid', () => {
	it('moves by one and stops at the edges', () => {
		expect(move(at(1, 1), 'ArrowRight', grid)).toEqual(at(1, 2));
		expect(move(at(1, 1), 'ArrowUp', grid)).toEqual(at(0, 1));
		expect(move(at(0, 0), 'ArrowUp', grid)).toEqual(at(0, 0));
		expect(move(at(2, 3), 'ArrowDown', grid)).toEqual(at(2, 3));
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

	it('answers only to the keys the grid owns', () => {
		expect(isGridKey('ArrowLeft')).toBe(true);
		expect(isGridKey('a')).toBe(false);
	});

	it('has nowhere to go in an empty grid', () => {
		expect(move(at(0, 0), 'ArrowDown', { rows: 0, columns: 0 })).toBeNull();
	});
});
