import { describe, expect, it } from 'vitest';
import { withAlpha } from './tokens';

describe('withAlpha', () => {
	it('converts a hex to rgba', () => {
		expect(withAlpha('#0072B2', 0.25)).toBe('rgba(0,114,178,0.25)');
		expect(withAlpha('#FFFFFF', 1)).toBe('rgba(255,255,255,1)');
	});
});
