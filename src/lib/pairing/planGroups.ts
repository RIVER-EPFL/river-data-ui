import type { Parameter } from '$api/crud';
import type {
	InstrumentNameConflict,
	PairingPlanEntry,
	PlanDeviceGroup,
	PlanInstrumentGroup,
	PlanInstrumentRef,
	PlanEntryUpdate,
	PlanReplicateSummary,
} from '$api/service';

/// The plan's entries as the review tabs read them: by site, by instrument and by parameter. Each is
/// a function of the entries alone.

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

/**
 * A row still asking: nothing attached, or a suggestion nobody has confirmed. A suggestion is a
 * creation or an attachment the plan read off a curve label, and words agreeing is not the source
 * naming the instrument (Q195).
 */
export function isAskingInstrument(d: InstrumentDecision): boolean {
	return d.group === null || !d.group.confirmed;
}

/** A row whose curve label matched more than one instrument, so the plan suggests neither. */
export function isAmbiguousInstrument(d: InstrumentDecision): boolean {
	return d.group?.resolved_by === 'ambiguous_label';
}

/**
 * A device channel's instrument as a decision, so its proposal is named, confirmed and accepted in
 * bulk like a lab one. A channel on a plan drafted without an instrument has nothing to decide.
 */
export function deviceDecisions(devices: PlanDeviceGroup[]): InstrumentDecision[] {
	return devices.flatMap((d): InstrumentDecision[] => {
		const g = d.instrument;
		if (!g) return [];
		return [
			{
				key: g.scope ?? d.anchor_stream_id,
				scope: g.scope ?? d.anchor_stream_id,
				name: g.name,
				proposedName: g.proposed_name ?? g.name,
				nameConflict: g.name_conflict ?? null,
				group: g,
				parameters: d.parameters,
				siteCount: 1,
				streamCount: d.stream_count,
				anchorStreamId: d.anchor_stream_id,
			},
		];
	});
}

/**
 * The one PATCH that accepts every suggestion still asking, and how many are held back because the
 * row is a choice rather than a suggestion: a name an instrument already carries, or a curve label
 * that matched two of them.
 */
export function suggestionAcceptance(decisions: InstrumentDecision[]): {
	updates: PlanEntryUpdate[];
	held: number;
} {
	const asking = decisions.filter(isAskingInstrument);
	const updates = asking
		.filter((d) => !d.nameConflict && !isAmbiguousInstrument(d))
		.map((d): PlanEntryUpdate =>
			d.group === null
				? { stream_id: d.anchorStreamId, instrument_name: d.proposedName, instrument_confirmed: true }
				: { stream_id: d.anchorStreamId, instrument_confirmed: true },
		);
	return { updates, held: asking.length - updates.length };
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

/** Which parameter row an edit is about: one code with one set of units. */
export interface ParamRowKey {
	name: string;
	units: string;
}

/**
 * Whether an entry belongs to that parameter row. Two source columns proposed under one code with
 * different units are two rows, so an edit to one is not an edit to the other.
 */
export function inParamRow(entry: PairingPlanEntry, row: ParamRowKey): boolean {
	return entry.parameter.name === row.name && entry.parameter.units === row.units;
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
	/** The decimal places the source declared, where every stream in the group declares the same. */
	decimalPlaces: number | null;
	/** The group's streams declare more than one precision, so the apply writes per slot. */
	decimalPlacesMixed: boolean;
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
			decimals: Set<number>;
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
				decimals: new Set(),
			};
			map.set(key, g);
		}
		if (typeof e.decimal_places === 'number') g.decimals.add(e.decimal_places);
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
			decimalPlaces: g.decimals.size === 1 ? [...g.decimals][0]! : null,
			decimalPlacesMixed: g.decimals.size > 1,
		});
	}
	return groups.sort((a, b) => a.name.localeCompare(b.name) || a.units.localeCompare(b.units));
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

/// A parameter group the source's registry names and the database does not hold.
export interface GroupCreation {
	code: string;
	label: string;
	description: string | null;
	/** Any entry of this category: the one a rename is sent on, since it renames all of them. */
	anchorStreamId: string;
	/** The parameters this apply would place in it, in the registry's order. */
	members: string[];
}

export interface Creations {
	projects: string[];
	sites: SiteCreation[];
	parameters: ParameterCreation[];
	groups: GroupCreation[];
}

/**
 * Sites the apply would create with no position. The portals carry an elevation and nothing else,
 * so the coordinates are the reviewer's to supply: a site is created once, and a site with no
 * position is absent from the map, from the Sites list's location cell, and from any ranking
 * against a weather station by distance.
 */
export function sitesWithoutCoordinates(sites: SiteCreation[]): SiteCreation[] {
	return sites.filter((s) => s.latitude === null || s.longitude === null);
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

	// A group is one decision behind every column of its category, so it is collected by code and
	// carries the members the apply would place in it.
	const groups = new Map<string, GroupCreation & { placed: Map<string, number> }>();
	for (const e of pairing) {
		const g = e.parameter.group;
		if (!g?.create) continue;
		const seen =
			groups.get(g.code) ??
			groups
				.set(g.code, {
					code: g.code,
					label: g.label,
					description: g.description ?? null,
					anchorStreamId: e.stream_id,
					members: [],
					placed: new Map(),
				})
				.get(g.code)!;
		if (!seen.placed.has(e.parameter.name)) seen.placed.set(e.parameter.name, g.ordinal);
	}

	return {
		projects: projects.sort((a, b) => a.localeCompare(b)),
		groups: [...groups.values()]
			.map(({ code, label, description, anchorStreamId, placed }) => ({
				code,
				label,
				description,
				anchorStreamId,
				members: [...placed.entries()]
					.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
					.map(([name]) => name),
			}))
			.sort((a, b) => a.label.localeCompare(b.label)),
		sites: [...sites.values()].sort((a, b) => a.name.localeCompare(b.name)),
		parameters: [...parameters.values()]
			.map(({ name, units, siteCount }) => ({ name, units, siteCount }))
			.sort((a, b) => a.name.localeCompare(b.name) || a.units.localeCompare(b.units)),
	};
}

/// The catalog a plan's parameter rows are matched against, by every name a row may carry.
///
/// A hundred rows ask the same question several times each, so the catalog is indexed once. The
/// first parameter claiming a name keeps it, which is the order a scan of the list would find.
export function parameterIndex(params: Parameter[]): Map<string, Parameter> {
	const index = new Map<string, Parameter>();
	for (const p of params) {
		for (const key of [p.code, p.name, ...(p.aliases ?? [])]) {
			const k = key?.trim().toLowerCase();
			if (k && !index.has(k)) index.set(k, p);
		}
	}
	return index;
}

/** One instrument the plan binds, with the ground it covers. */
export interface InstrumentBinding {
	name: string;
	streamCount: number;
	siteCount: number;
	parameters: string[];
	/** The apply mints this one; the others are already in the inventory. */
	create: boolean;
	/** Minted for a feed rather than named by a source or an operator, so it is no real device. */
	defaulted: boolean;
}

/** Every instrument the plan's pairing entries bind, counted by identity rather than by entry.
 *
 *  Registration mints an instrument for every stream, so most of these exist before the plan runs
 *  and `create` is the minority. Counting only the creations reports a plan that pairs 1,679
 *  streams to instruments as touching none. */
export function instrumentBindings(entries: PairingPlanEntry[]): InstrumentBinding[] {
	const map = new Map<
		string,
		InstrumentBinding & { streams: Set<string>; sites: Set<string>; params: Set<string> }
	>();
	for (const e of entries) {
		if (e.action !== 'pair' || !e.instrument) continue;
		const i = e.instrument;
		const key = i.id ?? i.source_key ?? i.name;
		let row = map.get(key);
		if (!row) {
			row = {
				name: i.name,
				streamCount: 0,
				siteCount: 0,
				parameters: [],
				create: i.create,
				defaulted: i.defaulted,
				streams: new Set(),
				sites: new Set(),
				params: new Set(),
			};
			map.set(key, row);
		}
		row.streams.add(e.stream_id);
		row.sites.add(e.site.name);
		row.params.add(e.parameter.name);
	}
	return [...map.values()]
		.map(({ streams, sites, params, ...row }) => ({
			...row,
			streamCount: streams.size,
			siteCount: sites.size,
			parameters: [...params].sort((a, b) => a.localeCompare(b)),
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The Instruments tab row a stream belongs to. Mirrors `instrument_key` in the API's
 * `sync/service.rs`, which groups that tab's rows, so every tab names the same row for a stream.
 * A device channel is its own row.
 */
export function instrumentRowKey(entry: PairingPlanEntry): string {
	if (entry.is_device) return `device:${entry.stream_id}`;
	const i = entry.instrument;
	if (i?.source_key) return `instrument:${i.source_key}`;
	if (i?.curve_column) return `column:${i.curve_column}`;
	return `parameter:${entry.parameter.group_key ?? entry.parameter.name}`;
}

/** One row of the Instruments tab: a device channel, a lab instrument, or a parameter without one. */
export interface InstrumentRow {
	key: string;
	decision: InstrumentDecision | null;
	device: PlanDeviceGroup | null;
}

/** The Instruments tab's rows in the order it lists them: device channels, then lab instruments. */
export function instrumentRows(
	devices: PlanDeviceGroup[],
	deviceDecisions: InstrumentDecision[],
	decisions: InstrumentDecision[],
): InstrumentRow[] {
	return [
		...devices.map((device) => ({
			key: `device:${device.anchor_stream_id}`,
			decision: deviceDecisions.find((d) => d.anchorStreamId === device.anchor_stream_id) ?? null,
			device,
		})),
		...decisions.map((decision) => ({ key: decision.key, decision, device: null })),
	];
}

/** How another tab names an Instruments tab row. */
export interface InstrumentLabel {
	key: string;
	name: string;
	/** The plan creates it. */
	isNew: boolean;
	/** Nothing is chosen yet. */
	none: boolean;
}

export function instrumentLabel(row: InstrumentRow): InstrumentLabel {
	const group = row.decision?.group ?? row.device?.instrument ?? null;
	if (group) return { key: row.key, name: group.name, isNew: group.create, none: false };
	if (row.device?.instrument_id) {
		return { key: row.key, name: row.device.instrument_name ?? row.device.serial, isNew: false, none: false };
	}
	// A device channel with nothing bound is minted from its serial when the plan is applied.
	if (row.device) return { key: row.key, name: row.device.serial, isNew: true, none: false };
	return { key: row.key, name: 'No instrument', isNew: false, none: true };
}

/** The instruments measuring these streams, one per row, in the order the streams are given. */
export function instrumentsOf(
	entries: PairingPlanEntry[],
	labels: Map<string, InstrumentLabel>,
): InstrumentLabel[] {
	const seen = new Map<string, InstrumentLabel>();
	for (const entry of entries) {
		if (entry.action !== 'pair') continue;
		const label = labels.get(instrumentRowKey(entry));
		if (label && !seen.has(label.key)) seen.set(label.key, label);
	}
	return [...seen.values()];
}

/** The parameters and sites each Instruments tab row measures, read from the streams it pairs. */
export function instrumentCoverage(
	entries: PairingPlanEntry[],
): Map<string, { parameters: string[]; sites: string[] }> {
	const acc = new Map<string, { parameters: Set<string>; sites: Set<string> }>();
	for (const entry of entries) {
		if (entry.action !== 'pair') continue;
		const key = instrumentRowKey(entry);
		const row = acc.get(key) ?? { parameters: new Set<string>(), sites: new Set<string>() };
		row.parameters.add(entry.parameter.name);
		row.sites.add(entry.site.name);
		acc.set(key, row);
	}
	return new Map(
		[...acc].map(([key, row]) => [key, { parameters: [...row.parameters].sort(), sites: [...row.sites].sort() }]),
	);
}
