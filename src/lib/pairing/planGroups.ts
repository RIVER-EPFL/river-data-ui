import type {
	InstrumentNameConflict,
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
	/** An instrument already carrying the proposed name, when the proposal collides with one. */
	nameConflict: InstrumentNameConflict | null;
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

/// What the apply will create, as rows rather than as counts. A count says how many; only the rows
/// say which, and a site is created once, so its attributes are corrected here or not at all.

export interface SiteCreation {
	name: string;
	latitude: number | null;
	longitude: number | null;
	altitudeM: number | null;
	/** A stream to address the edit to; every entry naming this site moves with it. */
	anchorStreamId: string;
	streamCount: number;
}

export interface ParameterCreation {
	name: string;
	units: string;
	siteCount: number;
}

export interface Creations {
	projects: string[];
	sites: SiteCreation[];
	parameters: ParameterCreation[];
	/** Instrument names the apply mints, one per instrument rather than per entry. */
	instruments: string[];
}

/** Every entity the plan's pairing entries would create, deduplicated the way the apply mints it. */
export function creations(entries: PairingPlanEntry[]): Creations {
	const pairing = entries.filter((e) => e.action === 'pair');

	const projects = [...new Set(pairing.filter((e) => e.project.create).map((e) => e.project.name))];

	const sites = new Map<string, SiteCreation>();
	for (const e of pairing) {
		if (!e.site.create) continue;
		const key = e.site.name.toLowerCase();
		const seen = sites.get(key);
		if (seen) {
			seen.streamCount += 1;
			continue;
		}
		sites.set(key, {
			name: e.site.name,
			latitude: e.site.latitude,
			longitude: e.site.longitude,
			altitudeM: e.site.altitude_m,
			anchorStreamId: e.stream_id,
			streamCount: 1,
		});
	}

	const parameters = new Map<string, ParameterCreation & { sites: Set<string> }>();
	for (const e of pairing) {
		if (!e.parameter.create) continue;
		const key = `${e.parameter.name}::${e.parameter.units}`;
		const seen =
			parameters.get(key) ??
			parameters
				.set(key, {
					name: e.parameter.name,
					units: e.parameter.units,
					siteCount: 0,
					sites: new Set(),
				})
				.get(key)!;
		seen.sites.add(e.site.name);
		seen.siteCount = seen.sites.size;
	}

	const instruments = new Map<string, string>();
	for (const e of pairing) {
		const i = e.instrument;
		if (!i?.create || i.id) continue;
		instruments.set(i.source_key || i.name, i.name);
	}

	return {
		projects: projects.sort((a, b) => a.localeCompare(b)),
		sites: [...sites.values()].sort((a, b) => a.name.localeCompare(b.name)),
		parameters: [...parameters.values()]
			.map(({ name, units, siteCount }) => ({ name, units, siteCount }))
			.sort((a, b) => a.name.localeCompare(b.name) || a.units.localeCompare(b.units)),
		instruments: [...new Set(instruments.values())].sort((a, b) => a.localeCompare(b)),
	};
}
