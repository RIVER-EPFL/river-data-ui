import { describe, expect, it } from 'vitest';
import { clickTarget, isAppClient } from './notificationClick';

describe('clickTarget', () => {
	it('opens the notification url when it carries one', () => {
		expect(clickTarget('/ui/alarms', '/ui')).toBe('/ui/alarms');
	});

	it('falls back to the app root under the configured base', () => {
		expect(clickTarget(undefined, '/ui')).toBe('/ui/');
	});

	it('falls back to the origin root with an empty base', () => {
		expect(clickTarget(undefined, '')).toBe('/');
	});
});

describe('isAppClient', () => {
	it('matches a tab under the configured base', () => {
		expect(isAppClient('https://river.example/ui/sites/1', '/ui')).toBe(true);
	});

	it('matches the base itself', () => {
		expect(isAppClient('https://river.example/ui', '/ui')).toBe(true);
	});

	it('refuses a tab outside the configured base', () => {
		expect(isAppClient('https://river.example/admin/sites', '/ui')).toBe(false);
	});

	it('refuses a sibling path sharing the base as a prefix', () => {
		expect(isAppClient('https://river.example/uix', '/ui')).toBe(false);
	});

	it('matches every tab with an empty base', () => {
		expect(isAppClient('https://river.example/sites', '')).toBe(true);
	});
});
