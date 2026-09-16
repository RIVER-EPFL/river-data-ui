import { describe, expect, it } from 'vitest';

import { originServiceHref } from './serviceLink';

describe('origin service link', () => {
	it('opens the status tab on the source system for an admin', () => {
		expect(originServiceHref('/app', { classification: 'sync', source_system: 'cnet' }, true)).toBe(
			'/app/system?tab=status&service=cnet',
		);
	});

	it('gives a non-admin no link', () => {
		expect(originServiceHref('', { classification: 'sync', source_system: 'cnet' }, false)).toBeNull();
	});

	it('gives a record that was not synced no link', () => {
		expect(originServiceHref('', { classification: 'manual', source_system: 'grab_sample' }, true)).toBeNull();
	});
});
