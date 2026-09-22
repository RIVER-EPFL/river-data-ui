<script lang="ts">
	import type { Snippet } from 'svelte';

	import type {
		PairingPlanEntry,
		PlanEntryUpdate,
		PlanReplicateSummary,
	} from '$api/service';
	import type { Parameter, Site } from '$api/crud';
	import type { SiteMetadata } from '$api/service';
	import PairSkipToggle from '$components/ui/PairSkipToggle.svelte';
	import InstrumentLink from '$components/pairing/InstrumentLink.svelte';
	import NamePicker from '$components/pairing/NamePicker.svelte';
	import ReviewTable, { type ReviewFilter } from '$components/pairing/ReviewTable.svelte';
	import type { InstrumentLabel, ParamGroup, SiteGroup } from '$lib/pairing/planGroups';

	// The plan's Sites review tab: one row per site, opening onto its streams. A site is mapped to an
	// existing one or created; the rows under it carry the per-stream decisions.
	let {
		planEntries,
		siteGroups,
		existingSites,
		expandedSites,
		expandedReplicates,
		existingParams,
		paramGroups,
		siteMetadataMap,
		matchParam,
		newParamOption,
		parseNewParamOption,
		queueUpdate,
		setEntryAction,
		setSiteAction,
		toggleExpand,
		siteConflicts,
		renameSiteGlobal,
		mapSiteToExisting,
		goToParam,
		instrumentsFor,
		goToInstruments,
		replicateChip,
		replicateRouting,
		valuesChip,
		streamPreview,
		onreviewsite,
		onmarkall,
		marking,
		query = $bindable(''),
		filter = $bindable('all'),
		page = $bindable(0),
	}: {
		planEntries: PairingPlanEntry[];
		siteGroups: SiteGroup[];
		existingSites: Site[];
		expandedSites: Set<string>;
		/** Which replicate families are showing their members, keyed as the chips key them. */
		expandedReplicates: Set<string>;
		existingParams: Parameter[];
		paramGroups: ParamGroup[];
		siteMetadataMap: Map<string, SiteMetadata>;
		matchParam: (name: string) => Parameter | undefined;
		newParamOption: (name: string, units: string) => string;
		parseNewParamOption: (value: string) => { name: string; units: string | null };
		queueUpdate: (updates: PlanEntryUpdate[], opts?: { immediate?: boolean }) => void;
		setEntryAction: (entry: PairingPlanEntry, action: 'pair' | 'skip') => void;
		setSiteAction: (group: SiteGroup, action: 'pair' | 'skip') => void;
		toggleExpand: (siteName: string) => void;
		/** What this plan cannot apply about a site, as a sentence per finding. */
		siteConflicts: (siteName: string) => string[];
		renameSiteGlobal: (oldName: string, newName: string) => void;
		mapSiteToExisting: (oldName: string, existingSite: Site) => void;
		goToParam: (paramName: string) => void;
		/** The instruments measuring these streams, as the Instruments tab names them. */
		instrumentsFor: (streamIds: string[]) => InstrumentLabel[];
		goToInstruments: (instruments: InstrumentLabel[], query: string) => void;
		/** The replicate marks, shared with the Parameters tab, so they are defined once. */
		replicateChip: Snippet<[string, PlanReplicateSummary, string]>;
		replicateRouting: Snippet<[PlanReplicateSummary, string]>;
		/** The preview handle and body a row without a replicate family carries instead. */
		valuesChip: Snippet<[string]>;
		streamPreview: Snippet<[string]>;
		/** Mark every row the site pairs as reviewed, or take that back. */
		onreviewsite: (group: SiteGroup, reviewed: boolean) => void;
		onmarkall: (reviewed: boolean) => void;
		marking: boolean;
		query?: string;
		filter?: ReviewFilter;
		page?: number;
	} = $props();

	const paramOptions = $derived([
		{
			label: 'Existing parameters',
			options: existingParams.map((ep) => ({ value: `db:${ep.id}`, label: `${ep.code} (${ep.default_units})`, title: ep.name })),
		},
		{
			label: 'Will be created',
			options: paramGroups
				.filter((p) => !matchParam(p.name))
				.map((p) => ({ value: newParamOption(p.name, p.units), label: `+ ${p.name} (${p.units})` })),
		},
	]);

	// Point one stream at an existing parameter or a named one, at this site only.
	function setEntryParameter(entry: PairingPlanEntry, val: string) {
		if (val.startsWith('db:')) {
			const ep = existingParams.find((p) => p.id === val.slice(3));
			if (!ep || ep.code === entry.parameter.name) return;
			entry.parameter.name = ep.code;
			entry.parameter.create = false;
			planEntries = [...planEntries];
			queueUpdate([{ stream_id: entry.stream_id, parameter_name: ep.code }]);
			return;
		}
		const { name, units } = parseNewParamOption(val);
		const unitsChanged = units !== null && units !== entry.parameter.units;
		if (name === entry.parameter.name && !unitsChanged) return;
		entry.parameter.name = name;
		entry.parameter.create = true;
		const update: PlanEntryUpdate = { stream_id: entry.stream_id, parameter_name: name };
		if (unitsChanged) {
			entry.parameter.units = units;
			update.parameter_units = units;
		}
		planEntries = [...planEntries];
		queueUpdate([update]);
	}

	const siteOptions = $derived([
		{ label: 'Existing sites', options: existingSites.map((es) => ({ value: `db:${es.id}`, label: es.name })) },
		{
			label: 'Will be created',
			options: siteGroups
				.filter((g) => !existingSites.some((es) => es.name.toLowerCase() === g.siteName.toLowerCase()))
				.map((g) => ({ value: `new:${g.siteName}`, label: `+ ${g.siteName}` })),
		},
	]);

	const siteMatch = (g: SiteGroup) =>
		existingSites.find((s) => s.name.toLowerCase() === g.siteName.toLowerCase());
</script>

{#snippet siteCell(group: SiteGroup)}
	{@const matched = siteMatch(group)}
	<div class="w-[260px]">
		<NamePicker
			value={matched ? `db:${matched.id}` : `new:${group.siteName}`}
			groups={siteOptions}
			name={group.siteName}
			status={matched ? 'existing' : 'new'}
			ariaLabel="Site for {group.siteName}"
			onpick={(val) => {
				if (val.startsWith('db:')) {
					const es = existingSites.find((x) => x.id === val.slice(3));
					if (es) mapSiteToExisting(group.siteName, es);
				} else {
					renameSiteGlobal(group.siteName, val.slice(4));
				}
			}}
			onrename={(name) => renameSiteGlobal(group.siteName, name)}
		/>
	</div>
	{#each siteConflicts(group.siteName) as message (message)}
		<div class="text-xs text-severity-warning mt-0.5">{message}</div>
	{/each}
	{#if group.warningCount > 0}
		<div
			class="text-xs text-severity-warning mt-0.5"
			title={group.entries.flatMap((en) => en.warnings.map((w) => w.message)).join(', ')}
		>{group.warningCount} warning{group.warningCount === 1 ? '' : 's'}</div>
	{/if}
{/snippet}

{#snippet projectCell(group: SiteGroup)}
	<span class="text-brand-muted">{group.project}</span>
{/snippet}

{#snippet streamsCell(group: SiteGroup)}
	<span class="text-brand-muted">{group.entries.length}</span>
{/snippet}

{#snippet streams(group: SiteGroup)}
	{@const meta = siteMetadataMap.get(group.siteName)}
	{@const siteDevices = meta?.devices ?? []}
	{#if meta && (meta.full_name || meta.catchment || meta.glacier_name || meta.latitude || meta.elevation || siteDevices.length > 0)}
		<div class="pl-10 pr-3 py-2 border-b border-brand-divider bg-brand-primary/5 text-xs flex flex-wrap gap-x-5 gap-y-1 text-brand-muted">
			{#if meta.full_name}<span><span class="font-medium text-brand-text">{meta.full_name}</span></span>{/if}
			{#if meta.catchment}<span>Catchment: {meta.catchment}</span>{/if}
			{#if meta.glacier_name}<span>Glacier: {meta.glacier_name}{meta.glacier_rgi ? ` (${meta.glacier_rgi})` : ''}</span>{/if}
			{#if meta.location_type}<span>Location: {meta.location_type}</span>{/if}
			{#if meta.latitude && meta.longitude}<span class="font-mono">{meta.latitude.toFixed(4)}, {meta.longitude.toFixed(4)}</span>{/if}
			{#if meta.altitude_m ?? meta.elevation}<span>Elevation: {meta.altitude_m ?? meta.elevation}m</span>{/if}
			{#each siteDevices as dev (dev.serial)}
				<span>
					Device: <span class="font-mono">{dev.serial}</span>{dev.model ? ` ${dev.model}` : ''}
					({dev.streams} channel{dev.streams === 1 ? '' : 's'})
				</span>
			{/each}
			{#if meta.sample_interval_sec}<span>Interval: {meta.sample_interval_sec}s</span>{/if}
		</div>
	{/if}
	{#each group.entries as entry (entry.stream_id)}
		{@const entryMatched = matchParam(entry.parameter.name)}
		{@const entryReplicates = entry.replicates}
		<div class="flex items-center gap-2 pl-10 pr-3 py-1.5 border-b border-brand-divider last:border-b-0 text-xs {entry.action === 'skip' ? 'opacity-50' : ''}">
			<div class="w-[260px] shrink-0">
				<NamePicker
					value={entryMatched ? `db:${entryMatched.id}` : newParamOption(entry.parameter.name, entry.parameter.units)}
					groups={paramOptions}
					name={entry.parameter.name}
					status={entryMatched ? 'existing' : 'new'}
					ariaLabel="Parameter for {entry.source_key}"
					onpick={(val) => setEntryParameter(entry, val)}
					onrename={(name) => setEntryParameter(entry, newParamOption(name, entry.parameter.units))}
				/>
			</div>
			<button
				onclick={() => goToParam(entry.parameter.name)}
				class="bg-transparent border-none cursor-pointer text-brand-muted hover:text-brand-primary text-[10px]"
				title="Edit this parameter for all sites"
			>edit all</button>
			{#if entryReplicates}
				{@render replicateChip(entry.stream_id, entryReplicates, entry.stream_id)}
			{:else}
				{@render valuesChip(entry.stream_id)}
			{/if}
			{#if entry.warnings.length > 0}
				<span class="text-severity-warning" title={entry.warnings.map((w) => w.message).join(', ')}>
					{entry.warnings.length} warning{entry.warnings.length === 1 ? '' : 's'}
				</span>
			{/if}
			<div class="ml-auto flex items-center gap-4">
				{#if entry.action === 'pair'}
					{@const instruments = instrumentsFor([entry.stream_id])}
					{#if instruments.length > 0}
						<span class="flex items-center gap-1.5">
							<span class="text-brand-muted">Instrument</span>
							<InstrumentLink {instruments} onopen={() => goToInstruments(instruments, entry.parameter.name)} />
						</span>
					{/if}
				{/if}
				<PairSkipToggle
					size="sm"
					value={entry.action === 'pair' ? 'pair' : 'skip'}
					onchange={(a) => setEntryAction(entry, a)}
					title="Pair or skip this stream"
				/>
			</div>
		</div>
		{#if expandedReplicates.has(entry.stream_id)}
			<div class="pl-12 pr-3 py-1.5 border-b border-brand-divider">
				{#if entryReplicates}
					{@render replicateRouting(entryReplicates, entry.stream_id)}
				{:else}
					{@render streamPreview(entry.stream_id)}
				{/if}
			</div>
		{/if}
	{/each}
{/snippet}

<ReviewTable
	rows={siteGroups}
	key={(g) => g.siteName}
	rowId={(g) => `site-row-${g.siteName}`}
	noun={['site', 'sites']}
	columns={[
		{ label: 'Site', cell: siteCell },
		{ label: 'Project', cell: projectCell },
		{ label: 'Streams', align: 'right', cell: streamsCell },
	]}
	searchText={(g) => `${g.siteName} ${g.project}`}
	pairing={{
		value: (g) => (g.pairCount === g.entries.length ? 'pair' : g.skipCount === g.entries.length ? 'skip' : 'mixed'),
		onchange: setSiteAction,
		title: (g) => `Pair or skip every stream at ${g.siteName}`,
	}}
	reviewed={(g) => (g.pairCount > 0 ? g.entries.every((e) => e.action === 'skip' || e.acknowledged === true) : null)}
	onreview={onreviewsite}
	muted={(g) => g.skipCount === g.entries.length}
	detail={streams}
	expanded={(g) => expandedSites.has(g.siteName)}
	ontoggle={(g) => toggleExpand(g.siteName)}
	{onmarkall}
	{marking}
	empty="This plan has no sites."
	bind:query
	bind:filter
	bind:page
/>
