import { afterEach, expect, it, vi } from 'vitest';
import { me } from './me.svelte';

afterEach(() => vi.restoreAllMocks());

it('allows interns to enter field data without running jobs', () => {
	vi.spyOn(me, 'level', 'get').mockReturnValue(1);
	expect(me.can('enterFieldData')).toBe(true);
	expect(me.can('writeData')).toBe(false);
});

it('refuses field entry without a member role', () => {
	vi.spyOn(me, 'level', 'get').mockReturnValue(0);
	expect(me.can('enterFieldData')).toBe(false);
});
