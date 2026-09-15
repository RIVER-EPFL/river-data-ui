import { describe, expect, it } from 'vitest';

import { pairingPlanHref, unpairedStreamsHref } from './sourceAudit';

describe('source audit links', () => {
	it('opens the plan wizard on the audited source', () => {
		expect(pairingPlanHref('', 'cnet')).toBe('/streams?step=source-select&source=cnet');
	});

	it('opens the streams list held to that source and its unpaired rows', () => {
		expect(unpairedStreamsHref('', 'cnet')).toBe('/streams?list_filter=unpaired&source=cnet');
	});

	it('keeps the deployment base path in front of both', () => {
		expect(pairingPlanHref('/river', 'metalp')).toBe(
			'/river/streams?step=source-select&source=metalp',
		);
		expect(unpairedStreamsHref('/river', 'metalp')).toBe(
			'/river/streams?list_filter=unpaired&source=metalp',
		);
	});

	it('escapes a source system that is not a bare word', () => {
		expect(unpairedStreamsHref('', 'grab sample')).toBe(
			'/streams?list_filter=unpaired&source=grab+sample',
		);
	});
});
