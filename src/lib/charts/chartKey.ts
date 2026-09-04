// What each mark on a chart means, named on screen.
//
// A vertical bar through a point could be a range, an interquartile range, a standard deviation or
// a confidence interval, and a standard deviation's divisor is itself a declared property of the
// slot. Two readers of the same plot must not be able to reach opposite conclusions about whether
// a grab and a sensor value agree, so every mark drawn is named, and only the marks actually drawn
// in that render are listed.

import { tokens } from './tokens';
import { estimatorLabel, type SdEstimator } from '$lib/sdEstimator';

export type ChartMark =
	| 'line'
	| 'spot'
	| 'spotAgreed'
	| 'spotSingle'
	| 'sdBar'
	| 'replicateDot'
	| 'flagged'
	| 'withdrawn'
	| 'minMaxBand'
	| 'sensorBand'
	| 'calibrationMarker'
	| 'alarmBand'
	| 'annotation';

export interface ChartKeyEntry {
	mark: ChartMark;
	label: string;
	/** Swatch colour, for the marks whose identity is a colour rather than a shape. */
	color?: string;
}

/** Which marks a single render actually drew, and what the slot declares about them. */
export interface ChartKeyPresence {
	line?: boolean;
	spot?: boolean;
	spotAgreed?: boolean;
	spotSingle?: boolean;
	sdBar?: boolean;
	replicateDots?: boolean;
	flagged?: boolean;
	withdrawn?: boolean;
	minMaxBand?: boolean;
	sensorBands?: boolean;
	calibrationMarkers?: boolean;
	alarmBands?: boolean;
	/** Annotation categories present in the window, in the order they should be listed. */
	annotationCategories?: string[];
	/** The slot's declared divisor, which is what the sd bar was computed under. */
	sdEstimator?: SdEstimator | null;
	units?: string | null;
}

function withUnits(label: string, units: string | null | undefined): string {
	return units ? `${label}, ${units}` : label;
}

/** The key for one render: only what is on screen, in the order marks are read. */
export function chartKeyEntries(p: ChartKeyPresence): ChartKeyEntry[] {
	const entries: ChartKeyEntry[] = [];
	if (p.line) entries.push({ mark: 'line', label: 'Continuous sensor series' });
	if (p.minMaxBand) entries.push({ mark: 'minMaxBand', label: 'Min to max within each bucket' });
	if (p.spot) entries.push({ mark: 'spot', label: 'Grab or spot measurement (mean of its replicates)' });
	if (p.spotAgreed)
		entries.push({ mark: 'spotAgreed', label: 'Replicated group whose replicates agree (sd 0)' });
	if (p.spotSingle)
		entries.push({ mark: 'spotSingle', label: 'Single measurement, no replicates' });
	if (p.sdBar)
		entries.push({
			mark: 'sdBar',
			label: withUnits(`±1 standard deviation, ${estimatorLabel(p.sdEstimator)}`, p.units),
		});
	if (p.replicateDots) entries.push({ mark: 'replicateDot', label: 'Individual replicate value' });
	if (p.flagged) entries.push({ mark: 'flagged', label: 'Flagged, excluded from statistics' });
	if (p.withdrawn)
		entries.push({ mark: 'withdrawn', label: 'Retracted at source, not served (reversible)' });
	if (p.sensorBands)
		entries.push({ mark: 'sensorBand', label: 'Which instrument was deployed' });
	if (p.calibrationMarkers)
		entries.push({ mark: 'calibrationMarker', label: 'Calibration change' });
	if (p.alarmBands)
		entries.push({ mark: 'alarmBand', label: 'In warning or alarm', color: tokens.severity.alarm.soft });
	for (const category of p.annotationCategories ?? []) {
		entries.push({
			mark: 'annotation',
			label: `Annotation: ${category}`,
			color: annotationColor(category),
		});
	}
	return entries;
}

/** The band colour a category is painted with, falling back the way the plot itself does. */
export function annotationColor(category: string): string {
	const colors = tokens.annotationCategories as Record<string, string>;
	return colors[category] ?? colors.other;
}
