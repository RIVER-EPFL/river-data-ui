import { describe, expect, it } from 'vitest';

import { HISTORY_LIMIT, push, undo, type History } from './history';

describe('undoing an edit to the grid', () => {
	it('undoes to the paste, not to the stored visit', () => {
		const stored = 'stored';
		const pasted = 'pasted';
		let history: History<string> = push<string>([], stored);
		history = push(history, pasted);

		const first = undo(history)!;
		expect(first.value).toBe(pasted);

		const second = undo(first.history)!;
		expect(second.value).toBe(stored);
		expect(undo(second.history)).toBeNull();
	});

	it('keeps a bounded stack, dropping the oldest', () => {
		let history: readonly number[] = [];
		for (let i = 0; i <= HISTORY_LIMIT; i += 1) history = push(history, i);
		expect(history).toHaveLength(HISTORY_LIMIT);
		expect(history[0]).toBe(1);
	});
});
