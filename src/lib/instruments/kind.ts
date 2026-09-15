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
	return isBookkeepingKind(kindOf(sensor));
}

/// The same rule over a kind on its own, for a reading that names its instrument by id and kind
/// rather than carrying the inventory row.
export function isBookkeepingKind(kind: string | null | undefined): boolean {
	return kind === 'source_parameter' || kind === 'entry_channel';
}

export function measuringInstruments<T extends Pick<Sensor, 'kind' | 'is_lab_instrument'>>(
	sensors: T[]
): T[] {
	return sensors.filter((s) => !isBookkeeping(s));
}

/// What an instrument picker offers: the rows something could have been measured on, still in
/// service, plus whatever the row already declares. A stored retired or bookkeeping instrument
/// stays on the list, because a select that drops it reports the wrong instrument as chosen.
export function pickerOptions<
	T extends Pick<Sensor, 'id' | 'kind' | 'is_lab_instrument' | 'is_active'>,
>(sensors: T[], declaredId?: string | null): T[] {
	const offered = measuringInstruments(sensors).filter((s) => !isRetired(s));
	if (!declaredId || offered.some((s) => s.id === declaredId)) return offered;
	const declared = sensors.find((s) => s.id === declaredId);
	return declared ? [...offered, declared] : offered;
}

/// Retirement is `is_active = false`; the column defaults to true and an unset flag is not a
/// retirement.
export function isRetired(sensor: Pick<Sensor, 'is_active'>): boolean {
	return sensor.is_active === false;
}

/// The `is_active` filter an instrument picker sends. A picker hides retired rows by default and
/// asks for the whole inventory when the operator turns them on, rather than for the retired half.
export function instrumentFilter(showRetired: boolean): { is_active?: boolean } {
	return showRetired ? {} : { is_active: true };
}

/// What a picker appends to a retired row's label, so a list offering one says what it is.
export function retiredSuffix(sensor: Pick<Sensor, 'is_active'>): string {
	return isRetired(sensor) ? ' (retired)' : '';
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

/// What a synced instrument row carries about where it came from. The register row is the identity
/// (Q7: 34 METALP rows have no serial and one serial is on two probes), so it is what tells two
/// same-named rows apart.
export interface InstrumentProvenance {
	/// The key the source knows the row by: `sensor_inventory:87` for a portal register row,
	/// `{source}:{parameter}` for a bookkeeping one.
	key: string | null;
	/// The portal register's own installation date, where the inventory supplies one.
	installed: string | null;
	/// Whether the register still has it in the field. Null where the source says nothing.
	inField: boolean | null;
}

export function provenanceOf(
	sensor: Pick<Sensor, 'source_key' | 'metadata'>
): InstrumentProvenance {
	const meta = sensor.metadata ?? {};
	const installed = meta.installation_date;
	const inField = meta.in_field;
	return {
		key: sensor.source_key ?? null,
		installed: typeof installed === 'string' && installed !== '' ? installed : null,
		inField: typeof inField === 'boolean' ? inField : null,
	};
}
