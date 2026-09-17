<script lang="ts">
	import type { Snippet } from 'svelte';

	import type {
		PairingPlanEntry,
		PlanReplicateSummary,
	} from '$api/service';
	import type { Parameter } from '$api/crud';
	import Button from '$components/ui/Button.svelte';
	import InstrumentLink from '$components/pairing/InstrumentLink.svelte';
	import NamePicker from '$components/pairing/NamePicker.svelte';
	import ReviewTable, { type ReviewFilter } from '$components/pairing/ReviewTable.svelte';
	import type { InstrumentLabel, ParamGroup } from '$lib/pairing/planGroups';
	import { focusOnMount } from '$lib/focus';

	// The plan's Parameters review tab: one row per parameter across every station that measures it,
	// so a decision taken here settles all of them at once.

	let {
		paramGroups,
		expandedParamGroups,
		expandedReplicates,
		rowWarnings,
		mapParamToExisting,
		renameGlobalParam,
		splitSourceToNewParam,
		startEditUnits,
		commitEditUnits,
		editingGlobalUnits = $bindable(),
		editUnitsValue = $bindable(),
		splitParamInput = $bindable(),
		splitParamValue = $bindable(),
		existingParams,
		editingLabel = $bindable(),
		editLabelValue = $bindable(),
		matchParam,
		newParamOption,
		parseNewParamOption,
		startEditLabel,
		commitEditLabel,
		setParamGroupAction,
		replicateChip,
		replicateRouting,
		unitConflicts,
		reviewedKeys,
		onreview,
		instrumentsFor,
		goToInstruments,
		onmarkall,
		marking,
		query = $bindable(''),
		filter = $bindable('all'),
		page = $bindable(0),
	}: {
		paramGroups: ParamGroup[];
		expandedParamGroups: Set<string>;
		expandedReplicates: Set<string>;
		rowWarnings: (pg: ParamGroup) => string[];
		mapParamToExisting: (oldName: string, existingParam: Parameter) => void;
		renameGlobalParam: (oldName: string, newName: string, newUnits?: string) => void;
		splitSourceToNewParam: (sourceName: string, newParamName: string) => void;
		startEditUnits: (paramName: string, currentUnits: string) => void;
		commitEditUnits: () => void;
		editingGlobalUnits: { name: string; units: string } | null;
		editUnitsValue: string;
		/** The source column being split onto a parameter of its own, or null. */
		splitParamInput: { groupName: string; sourceName: string } | null;
		splitParamValue: string;
		existingParams: Parameter[];
		/** The parameter whose plotting label is being edited, or null. */
		editingLabel: string | null;
		editLabelValue: string;
		matchParam: (name: string) => Parameter | undefined;
		newParamOption: (name: string, units: string) => string;
		parseNewParamOption: (value: string) => { name: string; units: string | null };
		startEditLabel: (pg: { name: string; label: string | null }) => void;
		commitEditLabel: () => void;
		setParamGroupAction: (pg: ParamGroup, action: 'pair' | 'skip') => void;
		/** The replicate marks, shared with the Sites tab, so they are defined once. */
		replicateChip: Snippet<[string, PlanReplicateSummary, string]>;
		replicateRouting: Snippet<[PlanReplicateSummary, string]>;
		/** Source parameters whose units disagree with the catalog entry they match. */
		unitConflicts: Snippet;
		/** The plan's reviewed project and parameter keys. */
		reviewedKeys: Set<string>;
		onreview: (paramName: string, reviewed: boolean) => void;
		/** The instruments measuring these streams, as the Instruments tab names them. */
		instrumentsFor: (streamIds: string[]) => InstrumentLabel[];
		goToInstruments: (instruments: InstrumentLabel[], query: string) => void;
		onmarkall: (reviewed: boolean) => void;
		marking: boolean;
		query?: string;
		filter?: ReviewFilter;
		page?: number;
	} = $props();

	// The Map-to dropdown offers the same two lists on every row, so the list of parameters this
	// plan would create is built once rather than filtered per row against the whole catalog.
	const createdGroups = $derived(paramGroups.filter((p) => !matchParam(p.name)));

	const paramOptions = $derived([
		{
			label: 'Existing parameters',
			options: existingParams.map((ep) => ({ value: `db:${ep.id}`, label: `${ep.code} (${ep.default_units})`, title: ep.name })),
		},
		{
			label: 'Will be created',
			options: createdGroups.map((p) => ({ value: newParamOption(p.name, p.units), label: `+ ${p.name} (${p.units})` })),
		},
	]);

</script>

{#snippet parameterCell(pg: ParamGroup)}
	{@const matched = matchParam(pg.name)}
	<div class="w-[260px]">
		<NamePicker
			value={matched ? `db:${matched.id}` : newParamOption(pg.name, pg.units)}
			groups={paramOptions}
			name={pg.name}
			status={matched ? 'existing' : 'new'}
			ariaLabel="Parameter for {pg.name}"
			onpick={(val) => {
				if (val.startsWith('db:')) {
					const ep = existingParams.find((x) => x.id === val.slice(3));
					if (ep) mapParamToExisting(pg.name, ep);
					return;
				}
				const { name: newName, units: newUnits } = parseNewParamOption(val);
				renameGlobalParam(pg.name, newName, newUnits ?? undefined);
			}}
			onrename={(name) => renameGlobalParam(pg.name, name)}
		/>
	</div>
	{#if pg.replicates}
		<div class="mt-1">
			{@render replicateChip(`param:${pg.name}`, pg.replicates, pg.streamIds[0])}
		</div>
		{#if expandedReplicates.has(`param:${pg.name}`)}
			<div class="mt-1 pl-2 border-l-2 border-brand-divider">
				{@render replicateRouting(pg.replicates, pg.streamIds[0])}
			</div>
		{/if}
	{/if}
	{#if rowWarnings(pg).length > 0}
		<div class="text-xs text-severity-warning mt-0.5">{rowWarnings(pg)[0]}</div>
	{/if}
{/snippet}

{#snippet sourceCell(pg: ParamGroup)}
	<div class="text-xs text-brand-muted font-mono max-w-[250px]">
		{#if pg.originalNames.length > 1}
			<button
				onclick={() => {
					const s = new Set(expandedParamGroups);
					if (s.has(pg.name)) s.delete(pg.name); else s.add(pg.name);
					expandedParamGroups = s;
				}}
				class="bg-transparent border-none cursor-pointer text-brand-muted hover:text-brand-primary text-xs p-0"
				title="Expand to split individual sources"
			>
				{expandedParamGroups.has(pg.name) ? '▾' : '▸'} {pg.originalNames.length} sources
			</button>
			{#if expandedParamGroups.has(pg.name)}
				<div class="mt-1 space-y-1 pl-2 border-l-2 border-brand-divider">
					{#each pg.originalNames as src}
						<div class="flex items-center gap-1">
							<span class="font-mono text-[11px]">{src}</span>
							{#if splitParamInput?.sourceName === src && splitParamInput?.groupName === pg.name}
								<input
									type="text"
									bind:value={splitParamValue}
									placeholder="New parameter name"
									class="px-1 py-0.5 rounded text-[11px] bg-brand-surface border border-brand-primary w-28"
									use:focusOnMount
									onkeydown={(e) => {
										if (e.key === 'Enter') splitSourceToNewParam(src, splitParamValue);
										if (e.key === 'Escape') { splitParamInput = null; splitParamValue = ''; }
									}}
								/>
								<button onclick={() => { splitParamInput = null; splitParamValue = ''; }} class="text-[10px] text-brand-muted cursor-pointer bg-transparent border-none">cancel</button>
							{:else}
								<Button
									variant="ghost"
									size="sm"
									onclick={() => { splitParamInput = { groupName: pg.name, sourceName: src }; splitParamValue = src; }}
									class="text-[10px] text-brand-primary"
								>split</Button>
							{/if}
						</div>
					{/each}
				</div>
			{:else}
				<div class="text-[10px] opacity-70 truncate">{pg.originalNames.join(', ')}</div>
			{/if}
		{:else}
			{pg.originalNames[0] ?? pg.originalName}
		{/if}
	</div>
{/snippet}

{#snippet nameCell(pg: ParamGroup)}
	{@const matched = matchParam(pg.name)}
	{#if matched}
		<span class="text-brand-muted" title="Edited on the parameter's own page">{matched.name}</span>
	{:else if editingLabel === pg.name}
		<input
			type="text"
			bind:value={editLabelValue}
			onkeydown={(e) => { if (e.key === 'Enter') commitEditLabel(); if (e.key === 'Escape') editingLabel = null; }}
			onblur={commitEditLabel}
			aria-label="Name for {pg.name}"
			class="px-1 py-0.5 border border-brand-primary rounded text-sm bg-brand-surface w-48"
			use:focusOnMount
		/>
	{:else}
		<button
			onclick={() => startEditLabel(pg)}
			aria-label="Edit the name of {pg.name}"
			class="bg-transparent border-0 border-b border-dashed border-brand-muted cursor-pointer text-brand-text hover:text-brand-primary hover:border-brand-primary text-left"
		>{pg.label ?? pg.name}</button>
	{/if}
{/snippet}

{#snippet unitsCell(pg: ParamGroup)}
	{@const matched = matchParam(pg.name)}
	<div class="text-xs">
		{#if matched}
			<span class="text-brand-muted" title="Edited on the parameter's own page">{matched.default_units}</span>
		{:else if editingGlobalUnits?.name === pg.name && editingGlobalUnits?.units === pg.units}
			<input type="text" bind:value={editUnitsValue} onkeydown={(e) => { if (e.key === 'Enter') commitEditUnits(); if (e.key === 'Escape') editingGlobalUnits = null; }} onblur={commitEditUnits} class="px-1 py-0.5 border border-brand-primary rounded text-xs bg-brand-surface w-20" use:focusOnMount />
		{:else}
			<button onclick={() => startEditUnits(pg.name, pg.units)} class="bg-transparent border-0 border-b border-dashed border-brand-muted cursor-pointer text-brand-muted hover:text-brand-primary hover:border-brand-primary">{pg.units || '--'}</button>
		{/if}
	</div>
{/snippet}

{#snippet instrumentCell(pg: ParamGroup)}
	{@const instruments = instrumentsFor(pg.streamIds)}
	<InstrumentLink {instruments} onopen={() => goToInstruments(instruments, pg.name)} />
{/snippet}

{#snippet sitesCell(pg: ParamGroup)}
	<span class="text-brand-muted">{pg.siteCount}</span>
{/snippet}

{@render unitConflicts()}
<ReviewTable
	rows={paramGroups}
	key={(pg) => pg.name}
	rowId={(pg) => `param-row-${pg.name}`}
	noun={['parameter', 'parameters']}
	columns={[
		{ label: 'Parameter', title: "The parameter's code: what CSV headers and the public API name it by", cell: parameterCell },
		{ label: 'Source name', cell: sourceCell },
		{ label: 'Name', title: 'What charts and tables show', cell: nameCell },
		{ label: 'Units', cell: unitsCell },
		{ label: 'Instrument', title: 'Chosen on the Instruments tab', cell: instrumentCell },
		{ label: 'Sites', align: 'right', cell: sitesCell },
	]}
	searchText={(pg) => [pg.name, pg.label ?? '', ...pg.originalNames].join(' ')}
	pairing={{
		value: (pg) => (pg.pairCount === pg.streamIds.length ? 'pair' : pg.pairCount === 0 ? 'skip' : 'mixed'),
		onchange: setParamGroupAction,
		title: (pg) => `Pair or skip ${pg.name} at every site`,
	}}
	reviewed={(pg) => (pg.pairCount > 0 ? reviewedKeys.has(`parameter:${pg.name}`) : null)}
	onreview={(pg, reviewed) => onreview(pg.name, reviewed)}
	muted={(pg) => pg.pairCount === 0}
	{onmarkall}
	{marking}
	empty="This plan has no parameters."
	bind:query
	bind:filter
	bind:page
/>
