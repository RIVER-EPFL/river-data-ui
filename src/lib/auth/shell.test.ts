import { describe, expect, it } from 'vitest';
import { shellBranch } from './shell';

describe('shellBranch', () => {
	it('shows the loading screen while auth initialises', () => {
		expect(shellBranch('loading', false)).toBe('loading');
	});

	it('shows the error screen when auth failed to initialise', () => {
		expect(shellBranch('error', false)).toBe('error');
	});

	it('shows the landing page to a visitor who is not signed in', () => {
		expect(shellBranch('anonymous', false)).toBe('landing');
	});

	it('shows the unauthorized page to a signed-in user with no riverdata role', () => {
		expect(shellBranch('authenticated', false)).toBe('unauthorized');
	});

	it('shows the app to a signed-in user holding a role', () => {
		expect(shellBranch('authenticated', 'intern')).toBe('app');
		expect(shellBranch('authenticated', 'admin')).toBe('app');
	});

	it('shows the app in local no-auth mode', () => {
		expect(shellBranch('no-auth', 'admin')).toBe('app');
	});
});
