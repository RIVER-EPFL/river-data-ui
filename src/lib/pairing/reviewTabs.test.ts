import { describe, expect, it } from 'vitest';
import { activeReviewTab, objectsTabLabel } from './reviewTabs';

describe('activeReviewTab', () => {
	it('opens a plan with objects still to accept on Objects', () => {
		expect(activeReviewTab(null, 28, 28)).toBe('objects');
	});

	it('opens a plan whose objects are all accepted on Parameters', () => {
		expect(activeReviewTab(null, 28, 0)).toBe('parameters');
	});

	it('opens a plan that creates nothing on Parameters', () => {
		expect(activeReviewTab(null, 0, 0)).toBe('parameters');
	});

	// Accepting the last object must not move the operator off the tab they are reading.
	it('keeps the operator on Objects after they chose it and accepted everything', () => {
		expect(activeReviewTab('objects', 28, 0)).toBe('objects');
	});

	it('falls through to Parameters when the chosen tab is not on the strip', () => {
		expect(activeReviewTab('objects', 0, 0)).toBe('parameters');
	});

	it('answers a chosen editor tab whatever the objects say', () => {
		expect(activeReviewTab('sites', 28, 28)).toBe('sites');
	});
});

describe('objectsTabLabel', () => {
	it('carries what the apply gate is still waiting on', () => {
		expect(objectsTabLabel(28, 6)).toBe('Objects (6 to accept)');
	});

	it('names the plan objects once none is open', () => {
		expect(objectsTabLabel(28, 0)).toBe('Objects (28)');
	});
});
