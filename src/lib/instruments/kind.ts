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
