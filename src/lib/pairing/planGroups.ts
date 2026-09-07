import type {
	PairingPlanEntry,
	PlanInstrumentGroup,
	PlanInstrumentRef,
	PlanReplicateSummary,
	SdEstimator,
} from '$api/service';

/// The plan's entries as the review tabs read them: by site, by instrument, by parameter, and by
/// the divisor decision a parameter's family still owes. Each is a function of the entries alone.

/// One instrument the plan puts to the operator: an instrument it has bound and a source parameter
/// still without one are the same decision at two stages, so they are one row either way.
export interface InstrumentDecision {
	key: string;
	scope: string;
	name: string;
	proposedName: string;
	group: PlanInstrumentGroup | null;
	parameters: string[];
	siteCount: number;
	streamCount: number;
	anchorStreamId: string;
}

export interface SiteGroup {
	siteName: string;
	project: string;
	entries: PairingPlanEntry[];
	pairCount: number;
	skipCount: number;
	warningCount: number;
}

export function siteGroups(entries: PairingPlanEntry[]): SiteGroup[] {
	const map = new Map<string, PairingPlanEntry[]>();
	for (const e of entries) {
		const arr = map.get(e.site.name);
		if (arr) arr.push(e);
		else map.set(e.site.name, [e]);
	}
	const groups: SiteGroup[] = [];
	for (const [siteName, siteEntries] of map) {
		groups.push({
			siteName,
			project: siteEntries[0]?.project.name ?? '',
			entries: siteEntries,
			pairCount: siteEntries.filter((e) => e.action === 'pair').length,
			skipCount: siteEntries.filter((e) => e.action === 'skip').length,
			warningCount: siteEntries.reduce((n, e) => n + e.warnings.length, 0),
		});
	}
	return groups.sort((a, b) => a.siteName.localeCompare(b.siteName));
}

// One curve column is one instrument across the whole source, so these are grouped by the
// instrument's identity, never by stream: 31 DOC streams are one decision.
export interface InstrumentGroup {
	key: string;
	instrument: PlanInstrumentRef;
	streamCount: number;
	siteCount: number;
	parameters: string[];
	anchorStreamId: string;
}

export function instrumentGroups(entries: PairingPlanEntry[]): InstrumentGroup[] {
	const map = new Map<
		string,
		{
			instrument: PlanInstrumentRef;
			streams: Set<string>;
			sites: Set<string>;
			params: Set<string>;
			anchor: string;
		}
	>();
	for (const e of entries) {
		if (e.action !== 'pair' || !e.instrument) continue;
		const key = e.instrument.curve_column ?? e.instrument.source_key ?? e.instrument.name;
		let g = map.get(key);
		if (!g) {
			g = {
				instrument: e.instrument,
				streams: new Set(),
				sites: new Set(),
				params: new Set(),
				anchor: e.stream_id,
			};
			map.set(key, g);
		}
		g.streams.add(e.stream_id);
		g.sites.add(e.site.name);
		g.params.add(e.parameter.name);
	}
	return [...map.entries()]
		.map(([key, g]) => ({
			key,
			instrument: g.instrument,
			streamCount: g.streams.size,
			siteCount: g.sites.size,
			parameters: [...g.params].sort(),
			anchorStreamId: g.anchor,
		}))
		.sort((a, b) => a.key.localeCompare(b.key));
}

/** Replicate families among the entries that will pair: stream count and how many portal readings
 *  columns collapse into them. */
export function familySummary(entries: PairingPlanEntry[]): { streams: number; columns: number } {
	let streams = 0;
	let columns = 0;
	for (const e of entries) {
		if (e.action !== 'pair' || !e.replicates) continue;
		streams += 1;
		columns += e.replicates.member_columns.length;
	}
	return { streams, columns };
}

export interface ParamGroup {
	name: string;
	label: string | null;
	originalName: string;
	originalNames: string[];
	groupKey: string | null;
	units: string;
	create: boolean;
	siteCount: number;
	streamIds: string[];
	warnings: string[];
	replicates: PlanReplicateSummary | null;
	instrument: PlanInstrumentRef | null;
	pairCount: number;
}

export function paramGroups(entries: PairingPlanEntry[]): ParamGroup[] {
	// Keyed on name AND units so same-name parameters with different units get separate rows.
	const map = new Map<
		string,
		{
			name: string;
			label: string | null;
			originalName: string;
			originalNames: Set<string>;
			groupKey: string | null;
			units: string;
			create: boolean;
			siteNames: Set<string>;
			streamIds: string[];
			warnings: Set<string>;
			replicates: PlanReplicateSummary | null;
			instrument: PlanInstrumentRef | null;
		}
	>();
	for (const e of entries) {
		const key = `${e.parameter.name}::${e.parameter.units}`;
		let g = map.get(key);
		if (!g) {
			g = {
				name: e.parameter.name,
				label: e.parameter.label ?? null,
				originalName: e.source_name ?? e.source_key,
				originalNames: new Set(),
				groupKey: e.parameter.group_key ?? null,
				units: e.parameter.units,
				create: e.parameter.create,
				siteNames: new Set(),
				streamIds: [],
				warnings: new Set(),
				replicates: e.replicates ?? null,
				instrument: e.instrument ?? null,
			};
			map.set(key, g);
		}
		if (!g.label && e.parameter.label) g.label = e.parameter.label;
		if (!g.replicates && e.replicates) g.replicates = e.replicates;
		if (!g.instrument && e.instrument) g.instrument = e.instrument;
		if (e.original_parameter_name) g.originalNames.add(e.original_parameter_name);
		g.siteNames.add(e.site.name);
		g.streamIds.push(e.stream_id);
		for (const w of e.warnings) g.warnings.add(w.message);
	}
	const groups: ParamGroup[] = [];
	for (const g of map.values()) {
		const pairCount = entries.filter(
			(e) => g.streamIds.includes(e.stream_id) && e.action === 'pair',
		).length;
		groups.push({
			name: g.name,
			label: g.label,
			originalName: g.originalName,
			originalNames: [...g.originalNames],
			groupKey: g.groupKey,
			units: g.units,
			create: g.create,
			siteCount: g.siteNames.size,
			streamIds: g.streamIds,
			warnings: [...g.warnings],
			replicates: g.replicates,
			instrument: g.instrument,
			pairCount,
		});
	}
	return groups.sort((a, b) => a.name.localeCompare(b.name) || a.units.localeCompare(b.units));
}

export interface SdDecision {
	paramName: string;
	entries: PairingPlanEntry[];
	declared: SdEstimator | '';
	holds: number;
	population: number;
}

/** One row per parameter whose source ships its own sd column, with the declaration the whole group
 *  currently carries ('' = mixed or undeclared) and the audit evidence summed over its streams.
 *  Declaring here writes every entry of that parameter, so one choice settles all of its stations. */
export function sdDecisions(entries: PairingPlanEntry[]): SdDecision[] {
	const map = new Map<string, SdDecision>();
	for (const e of entries) {
		if (!e.replicates?.portal_sd_column) continue;
		let g = map.get(e.parameter.name);
		if (!g) {
			g = { paramName: e.parameter.name, entries: [], declared: '', holds: 0, population: 0 };
			map.set(e.parameter.name, g);
		}
		g.entries.push(e);
		g.holds += e.sd_holds ?? 0;
		g.population += e.sd_population_holds ?? 0;
	}
	for (const g of map.values()) {
		const values = new Set(
			g.entries.map((e) => (e as { sd_estimator?: SdEstimator | null }).sd_estimator ?? ''),
		);
		g.declared = values.size === 1 ? [...values][0] : '';
	}
	return [...map.values()].sort((a, b) => a.paramName.localeCompare(b.paramName));
}
