import { describe, expect, it } from 'vitest';
import { pendingOnUnion } from './pendingMarks';

// Union axis of a continuous arm at 0, 10, 20 and a spot arm at 10.
const union = new Map([
	[0, 0],
	[10, 1],
	[20, 2],
]);

describe('pendingOnUnion', () => {
	it('places a pending spot point on the union axis of its own arm only', () => {
		const line = pendingOnUnion([0, 10, 20], [false, false, false], union, 3);
		const spot = pendingOnUnion([10], [true], union, 3);
		expect(line).toBeNull();
		expect(spot).toEqual([null, true, null]);
	});

	it('is null for an arm that carries no pending point', () => {
		expect(pendingOnUnion([10], null, union, 3)).toBeNull();
		expect(pendingOnUnion([10], [null], union, 3)).toBeNull();
	});

	it('keeps a pending continuous point where the arm drew it', () => {
		expect(pendingOnUnion([0, 20], [null, true], union, 3)).toEqual([null, null, true]);
	});
});
