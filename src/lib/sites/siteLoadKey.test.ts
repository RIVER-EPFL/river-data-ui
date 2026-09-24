import { describe, expect, it } from 'vitest';
import { siteLoadKey } from './siteLoadKey';

const SITE = 'site-1';
const POINT = '?point=sp-1&t=2026-07-14T09:00:00Z&mt=spot';

describe('siteLoadKey', () => {
	it('is unchanged when a point record opens', () => {
		expect(siteLoadKey(SITE, POINT)).toBe(siteLoadKey(SITE, ''));
	});

	it('is unchanged when a point record closes', () => {
		expect(siteLoadKey(SITE, '?start=2026-01-01T00:00:00Z')).toBe(
			siteLoadKey(SITE, `?start=2026-01-01T00:00:00Z&point=sp-1&t=2026-07-14T09:00:00Z&mt=spot`),
		);
	});

	it('is unchanged when the tab or the expanded visit changes', () => {
		expect(siteLoadKey(SITE, '?tab=visits&event=ev-1')).toBe(siteLoadKey(SITE, '?tab=status'));
	});

	it('is unchanged when a record opens inside the expanded visit', () => {
		expect(siteLoadKey(SITE, '?tab=visits&event=ev-1&parameter=doc')).toBe(
			siteLoadKey(SITE, '?tab=visits&event=ev-1'),
		);
	});

	it('changes with the site', () => {
		expect(siteLoadKey(SITE, POINT)).not.toBe(siteLoadKey('site-2', POINT));
	});

	it('changes with the deep-linked window', () => {
		expect(siteLoadKey(SITE, '?start=2026-01-01T00:00:00Z&end=2026-01-02T00:00:00Z')).not.toBe(
			siteLoadKey(SITE, ''),
		);
	});

	it('does not depend on the order the parameters were written in', () => {
		expect(siteLoadKey(SITE, '?focus=a&start=b')).toBe(siteLoadKey(SITE, '?start=b&focus=a'));
	});
});
