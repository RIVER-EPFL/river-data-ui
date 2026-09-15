import { describe, expect, it } from 'vitest';

import { HOLD_KINDS } from '$api/service';
import { KIND_LABEL, KIND_STYLE, KIND_TIP } from './holds';

describe('the review queue speaks for every hold kind', () => {
	it('labels, styles and explains each one', () => {
		for (const kind of HOLD_KINDS) {
			expect(KIND_LABEL[kind], `${kind} has no label`).toBeTruthy();
			expect(KIND_STYLE[kind], `${kind} has no chip style`).toBeTruthy();
			expect(KIND_TIP[kind], `${kind} has no explanation`).toBeTruthy();
		}
	});

	it('carries the hand-entry hold an intern save raises', () => {
		expect(HOLD_KINDS).toContain('unverified_entry');
	});
});
