import { describe, expect, it } from 'vitest';
import { activeReviewTab } from './reviewTabs';

const tabs = (states: Record<string, string>) =>
	Object.entries(states).map(([tab, state]) => ({ tab: tab as never, state }));

describe('activeReviewTab', () => {
	it('opens on the first tab still to review', () => {
		expect(activeReviewTab(null, tabs({ projects: 'done', sites: 'blocking', parameters: 'blocking' }))).toBe('sites');
	});

	it('opens on Parameters once everything is reviewed', () => {
		expect(activeReviewTab(null, tabs({ projects: 'done', sites: 'done', parameters: 'done' }))).toBe('parameters');
	});

	// Reviewing the last project must not move the operator off the tab they are reading.
	it('keeps the tab the operator chose', () => {
		expect(activeReviewTab('projects', tabs({ projects: 'done', sites: 'blocking' }))).toBe('projects');
	});

	it('falls through when the chosen tab is not on the strip', () => {
		expect(activeReviewTab('objects' as never, tabs({ projects: 'blocking' }))).toBe('projects');
	});
});
