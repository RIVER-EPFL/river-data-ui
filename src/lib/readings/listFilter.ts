export type FlagFilter = 'any' | 'flagged' | 'clean';

export interface ReadingsFilterState {
	siteId: string;
	parameterId: string;
	instrumentId: string;
	curveId: string;
	from: string;
	to: string;
	kind: string;
	flagged: FlagFilter;
	unverifiedOnly: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function defaultFilter(now: Date = new Date()): ReadingsFilterState {
	return {
		siteId: '',
		parameterId: '',
		instrumentId: '',
		curveId: '',
		from: new Date(now.getTime() - 7 * DAY_MS).toISOString(),
		to: '',
		kind: '',
		flagged: 'any',
		unverifiedOnly: false,
	};
}

/**
 * The filter a link into the list asks for: `site`, `parameter`, `from` and `to`. What the query
 * does not name keeps its default, so a link naming a parameter and a span leaves the rest alone.
 */
export function filterFromQuery(
	query: URLSearchParams,
	now: Date = new Date(),
): ReadingsFilterState {
	const base = defaultFilter(now);
	const named = (key: string) => query.get(key)?.trim() || null;
	return {
		...base,
		siteId: named('site') ?? base.siteId,
		parameterId: named('parameter') ?? base.parameterId,
		from: named('from') ?? base.from,
		to: named('to') ?? base.to,
	};
}

export function readingsFilter(state: ReadingsFilterState): Record<string, unknown> {
	const filter: Record<string, unknown> = {};
	if (state.siteId) filter.site_id = state.siteId;
	if (state.parameterId) filter.parameter_id = state.parameterId;
	if (state.instrumentId) filter.sensor_id = state.instrumentId;
	if (state.curveId) filter.standard_curve_id = state.curveId;
	if (state.from) filter.time_gte = state.from;
	if (state.to) filter.time_lte = state.to;
	if (state.kind) filter.provenance_kind = state.kind;
	if (state.flagged === 'flagged') filter.is_flagged = true;
	if (state.flagged === 'clean') filter.is_flagged = false;
	if (state.unverifiedOnly) filter.unverified = true;
	return filter;
}

export const PROVENANCE_KINDS: Array<[string, string]> = [
	['sync', 'Sync'],
	['manual', 'Entered by hand'],
	['csv_import', 'CSV import'],
	['batch', 'API batch'],
	['tool_run', 'Tool run'],
	['chain', 'Calculation chain'],
	['derived', 'Derived'],
];
