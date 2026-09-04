import { describe, expect, it } from 'vitest';
import { siteMarkerHtml } from './siteMarker';
import { severityDescription } from '$lib/alarms';

const ok = { severity: 'ok' as const, alarmCount: 0, warningCount: 0 };
const warning = { severity: 'warning' as const, alarmCount: 0, warningCount: 2 };
const alarm = { severity: 'alarm' as const, alarmCount: 3, warningCount: 1 };

describe('severityDescription', () => {
	it('names the severity and what is open behind it', () => {
		expect(severityDescription('alarm', 3, 1)).toBe('Alarm: 3 alarms, 1 warning');
		expect(severityDescription('warning', 0, 2)).toBe('Warning: 2 warnings');
		expect(severityDescription('ok', 0, 0)).toBe('OK: no active alarms');
	});
});

describe('siteMarkerHtml', () => {
	// A disc whose only channel is hue is read as "some site" by a deuteranope and carries nothing
	// at all in a monochrome screenshot.
	it('prints the count inside the marker', () => {
		expect(siteMarkerHtml(alarm, 22)).toContain('>3<');
		expect(siteMarkerHtml(warning, 22)).toContain('>2<');
	});

	it('leaves an untroubled marker unlabelled rather than printing a zero', () => {
		expect(siteMarkerHtml(ok, 22)).not.toContain('>0<');
	});

	it('carries the severity as an accessible name on every marker', () => {
		for (const status of [ok, warning, alarm]) {
			expect(siteMarkerHtml(status, 22)).toContain(
				`aria-label="${severityDescription(status.severity, status.alarmCount, status.warningCount)}"`,
			);
		}
	});

	it('escapes nothing it did not build, the label being ours', () => {
		expect(siteMarkerHtml(alarm, 22)).toMatch(/role="img"/);
	});
});
