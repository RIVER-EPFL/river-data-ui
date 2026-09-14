import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatInstant, jobDetailPath, triggerLabel } from './utils';

const MS = Date.UTC(2026, 0, 15, 10, 30);

describe('formatInstant', () => {
	it('renders an instant exactly as the rest of the UI renders a date', () => {
		expect(formatInstant(MS)).toBe(formatDateTime(new Date(MS)));
	});

	it('labels the UTC instant when asked, whatever the preference says', () => {
		const utc = formatInstant(MS, { utc: true });
		expect(utc).toContain('UTC');
		expect(utc).toContain(formatDate(new Date(MS)).split(',')[0]);
	});
});

describe('job notifications', () => {
	it('names the pairing plan jobs rather than printing their trigger', () => {
		expect(triggerLabel('plan_apply')).toBe('Applying pairing plan');
		expect(triggerLabel('plan_revert')).toBe('Reverting pairing plan');
	});

	it('links a job to the tab that opens it, by id', () => {
		expect(jobDetailPath('3f1a')).toBe('/system?tab=jobs&job=3f1a');
	});
});
