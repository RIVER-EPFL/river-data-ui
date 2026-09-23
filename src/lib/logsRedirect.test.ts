import { describe, expect, it } from 'vitest';
import { logsRedirectTarget } from './logsRedirect';

describe('logsRedirectTarget', () => {
	it('carries a token filter onto the System page Logs tab', () => {
		expect(logsRedirectTarget(new URLSearchParams('tab=audit&token=tok-1'))).toBe('/system?tab=logs&token=tok-1');
	});

	it('keeps a jobs deep link and its job id', () => {
		expect(logsRedirectTarget(new URLSearchParams('tab=jobs&job=job-7'))).toBe('/system?tab=jobs&job=job-7');
	});

	it('lands a bare URL on the Logs tab', () => {
		expect(logsRedirectTarget(new URLSearchParams(''))).toBe('/system?tab=logs');
	});

	it('keeps every parameter it does not rewrite', () => {
		expect(logsRedirectTarget(new URLSearchParams('service=svc-2&tab=sync&focus=a%26b'))).toBe(
			'/system?tab=logs&service=svc-2&focus=a%26b',
		);
	});
});
