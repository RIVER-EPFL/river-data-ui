import type { Sensor } from '$api/crud';

/// What an instrument row is. Three of the four minting paths produce something that is not a
/// device, and only `device` and `lab` name something an operator could have measured on.
export type InstrumentKind = 'device' | 'lab' | 'source_parameter' | 'entry_channel';

const LABELS: Record<InstrumentKind, string> = {
	device: 'Field',
	lab: 'Lab',
	source_parameter: 'Source parameter',
	entry_channel: 'Entry channel',
};

export function kindOf(sensor: Pick<Sensor, 'kind' | 'is_lab_instrument'>): InstrumentKind {
	const kind = sensor.kind as InstrumentKind | undefined;
	if (kind && kind in LABELS) return kind;
	return sensor.is_lab_instrument ? 'lab' : 'device';
}

export function kindLabel(sensor: Pick<Sensor, 'kind' | 'is_lab_instrument'>): string {
	return LABELS[kindOf(sensor)];
}

/// A bookkeeping row exists so a reading can name something; nothing measured on it, so it is
/// never offered where an operator picks the instrument a value was measured on.
export function isBookkeeping(sensor: Pick<Sensor, 'kind' | 'is_lab_instrument'>): boolean {
	const kind = kindOf(sensor);
	return kind === 'source_parameter' || kind === 'entry_channel';
}

export function measuringInstruments<T extends Pick<Sensor, 'kind' | 'is_lab_instrument'>>(
	sensors: T[]
): T[] {
	return sensors.filter((s) => !isBookkeeping(s));
}

/// What an instrument's inventory row states where a device states its deployment. A lab
/// instrument never has one, so "Undeployed" says nothing about it; the curves fitted on it and
/// when one of them last corrected a reading are what say whether it is still in use.
export interface InUseCell {
	text: string;
	title: string;
}

export function inUseCell(
	sensor: Pick<Sensor, 'kind' | 'is_lab_instrument' | 'curve_count' | 'last_curve_use'>,
	deployedFrom: string | null | undefined,
	relative: (iso: string) => string
): InUseCell {
	const kind = kindOf(sensor);
	if (kind === 'device') {
		return deployedFrom
			? { text: relative(deployedFrom), title: 'Deployed since this date' }
			: { text: 'Undeployed', title: 'No open deployment: this instrument is at no site' };
	}
	if (isBookkeeping(sensor)) {
		return {
			text: '—',
			title: 'A bookkeeping row, so a reading can name an instrument. Nothing was measured on it',
		};
	}
	const curves = sensor.curve_count ?? 0;
	if (sensor.last_curve_use) {
		return {
			text: relative(sensor.last_curve_use),
			title: `Last reading corrected by one of its ${curves} curve${curves === 1 ? '' : 's'}`,
		};
	}
	return {
		text: curves > 0 ? 'Unused' : 'No curves',
		title:
			curves > 0
				? `${curves} curve${curves === 1 ? '' : 's'} fitted, none used yet`
				: 'No curve has been fitted on this instrument',
	};
}
