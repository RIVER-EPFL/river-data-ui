import { tokens } from '$lib/charts/tokens';
import { severityDescription, type Severity } from '$lib/alarms';

export interface MarkerStatus {
	severity: Severity | string;
	alarmCount: number;
	warningCount: number;
}

const severityColor: Record<string, string> = {
	ok: tokens.severity.ok.fill,
	warning: tokens.severity.warning.fill,
	alarm: tokens.severity.alarm.fill,
};

/**
 * A map marker. The count of what is open is printed inside it and the severity is spelled out as
 * the accessible name, so the disc's colour is never the only channel carrying either.
 */
export function siteMarkerHtml(status: MarkerStatus, size: number): string {
	const color = severityColor[status.severity] ?? tokens.severity.unknown.main;
	const count = status.alarmCount || status.warningCount;
	const label = severityDescription(
		status.severity as Severity,
		status.alarmCount,
		status.warningCount,
	);
	const text = status.severity === 'alarm' || status.severity === 'warning' ? String(count) : '';
	const onColor = status.severity === 'warning' ? tokens.severity.warning.text : '#FFFFFF';
	return (
		`<div role="img" aria-label="${label}" title="${label}" style="width:${size}px;height:${size}px;` +
		`border-radius:50%;background:${color};border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);` +
		`cursor:pointer;transition:transform 0.15s;display:flex;align-items:center;justify-content:center;` +
		`color:${onColor};font-size:11px;font-weight:700;line-height:1"` +
		` onmouseenter="this.style.transform='scale(1.3)'" onmouseleave="this.style.transform='scale(1)'">` +
		`${text}</div>`
	);
}
