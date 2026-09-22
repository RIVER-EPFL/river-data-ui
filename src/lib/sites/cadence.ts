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

/// What `GET /sites/{id}/detail` reports per parameter, as the opening choices read it.
export interface ParameterCadence {
	frequency?: string | null;
	reading_count?: number | null;
}

/// The cadence a site's own data is in, over the parameters that hold any: `low` or `high` when
/// every one of them is that, `all` when they are mixed or the site holds nothing yet.
export function siteCadence(parameters: ParameterCadence[]): Frequency {
	const withData = parameters.filter((p) => (p.reading_count ?? 0) > 0);
	if (withData.length === 0) return 'all';
	if (withData.every((p) => p.frequency === 'low')) return 'low';
	if (withData.every((p) => p.frequency === 'high')) return 'high';
	return 'all';
}

/// The tab a site opens on. Every value at a spot-only site is a visit value, so the visits grid
/// is the record; anything else opens on the charts.
export function openingTab(parameters: ParameterCadence[]): 'charts' | 'visits' {
	return siteCadence(parameters) === 'low' ? 'visits' : 'charts';
}
