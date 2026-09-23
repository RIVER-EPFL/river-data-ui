/// Which parameters a chosen cadence covers, so choosing one shows the charts it can draw rather
/// than every chart with the uncovered ones left empty.

import type { Frequency } from '$lib/charts/multiSiteSeries';

/// What `GET /sites/{id}/parameters` reports about the cadences a parameter holds.
export interface CadenceExtent {
	has_continuous?: boolean;
	has_spot?: boolean;
}

/// Whether the cadence reaches this parameter. A parameter the site detail does not describe is
/// kept: an unknown extent is not evidence of an absent one.
export function coversCadence(extent: CadenceExtent | undefined, frequency: Frequency): boolean {
	if (!extent || frequency === 'all') return true;
	return frequency === 'low' ? extent.has_spot === true : extent.has_continuous === true;
}

/// The parameters a cadence draws, and how many it leaves out. The count is stated on the page:
/// a list that shrinks without saying so reads as a record that lost data.
export function byCadence<T>(
	params: T[],
	extentOf: (param: T) => CadenceExtent | undefined,
	frequency: Frequency
): { shown: T[]; hidden: number } {
	const shown = params.filter((p) => coversCadence(extentOf(p), frequency));
	return { shown, hidden: params.length - shown.length };
}

/// What `GET /sites/{id}/detail` reports per parameter, as the opening choices read it: the
/// declared cadence and what the rows actually hold.
export interface ParameterCadence extends CadenceExtent {
	frequency?: string | null;
	reading_count?: number | null;
}

/// Which cadences a site's rows hold. A site holding nothing reports neither, and is left with
/// both live rather than locked over a record that simply has nothing yet.
export function heldCadences(parameters: CadenceExtent[]): { high: boolean; low: boolean } {
	const held = {
		high: parameters.some((p) => p.has_continuous === true),
		low: parameters.some((p) => p.has_spot === true),
	};
	return held.high || held.low ? held : { high: true, low: true };
}

/// The cadences the chips offer: only what is held, and All only where both are.
export function offeredCadences(available: { high: boolean; low: boolean }): Frequency[] {
	if (available.high && available.low) return ['high', 'low', 'all'];
	if (available.low) return ['low'];
	return ['high'];
}

/// A chosen cadence the data holds, else the one it does hold.
export function heldChoice(value: Frequency, available: { high: boolean; low: boolean }): Frequency {
	const offered = offeredCadences(available);
	return offered.includes(value) ? value : offered[0];
}

/// The cadence a site opens in. What the rows hold decides it: `low` or `high` when only that is
/// held, `all` when both are. The declaration is read only where the detail reports no holdings,
/// over the parameters that hold any data.
export function siteCadence(parameters: ParameterCadence[]): Frequency {
	const withData = parameters.filter((p) => (p.reading_count ?? 0) > 0);
	if (withData.length === 0) return 'all';
	const reported = withData.some((p) => p.has_continuous != null || p.has_spot != null);
	if (reported) {
		const held = heldCadences(withData);
		return held.high && held.low ? 'all' : held.low ? 'low' : 'high';
	}
	if (withData.every((p) => p.frequency === 'low')) return 'low';
	if (withData.every((p) => p.frequency === 'high')) return 'high';
	return 'all';
}

/// The tab a site opens on. Every value at a spot-only site is a visit value, so the visits grid
/// is the record; anything else opens on the charts.
export function openingTab(parameters: ParameterCadence[]): 'charts' | 'visits' {
	return siteCadence(parameters) === 'low' ? 'visits' : 'charts';
}
