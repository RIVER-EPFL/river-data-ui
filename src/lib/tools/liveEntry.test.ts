import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { entrySnapshot, hasUnsavedValues, previewScheduler } from './liveEntry';

describe('the preview a form runs as values are typed', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('runs once, after typing pauses', async () => {
		const run = vi.fn(async () => 1);
		const apply = vi.fn();
		const s = previewScheduler(run, apply, 400);
		s.schedule();
		await vi.advanceTimersByTimeAsync(200);
		s.schedule();
		await vi.advanceTimersByTimeAsync(399);
		expect(run).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(run).toHaveBeenCalledTimes(1);
		expect(apply).toHaveBeenCalledWith(1);
	});

	it('drops the answer for values that have since changed', async () => {
		let resolveOld: (v: string) => void = () => {};
		const answers = [
			new Promise<string>((r) => (resolveOld = r)),
			Promise.resolve('new'),
		];
		const apply = vi.fn();
		const s = previewScheduler(() => answers.shift()!, apply, 10);
		s.schedule();
		await vi.advanceTimersByTimeAsync(10);
		s.schedule();
		await vi.advanceTimersByTimeAsync(10);
		resolveOld('old');
		await vi.runAllTimersAsync();
		expect(apply).toHaveBeenCalledTimes(1);
		expect(apply).toHaveBeenCalledWith('new');
	});

	it('applies nothing once cancelled', async () => {
		const apply = vi.fn();
		const s = previewScheduler(async () => 1, apply, 10);
		s.schedule();
		s.cancel();
		await vi.runAllTimersAsync();
		expect(apply).not.toHaveBeenCalled();
	});
});

describe('whether a form holds unsaved values', () => {
	const form = { values: { doc: '1.2' } };

	it('is false for the values it opened or last saved with', () => {
		expect(hasUnsavedValues(entrySnapshot(form, {}), form, {})).toBe(false);
	});

	it('is true once a value or a curve moves', () => {
		const snap = entrySnapshot(form, {});
		expect(hasUnsavedValues(snap, { values: { doc: '1.3' } }, {})).toBe(true);
		expect(hasUnsavedValues(snap, form, { corr: { slope: 2 } })).toBe(true);
	});

	it('is false with no form open', () => {
		expect(hasUnsavedValues(null, form, {})).toBe(false);
	});
});
