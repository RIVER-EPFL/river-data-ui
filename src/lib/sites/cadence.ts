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
