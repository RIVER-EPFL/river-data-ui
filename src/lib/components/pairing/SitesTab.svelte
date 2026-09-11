<script lang="ts">
	import type { Snippet } from 'svelte';

	import type {
		PairingPlanEntry,
		PlanEntryUpdate,
		PlanReplicateSummary,
		SdEstimator,
	} from '$api/service';
	import type { Parameter, Site } from '$api/crud';
	import type { SiteMetadata } from '$api/service';
	import Button from '$components/ui/Button.svelte';
	import PairSkipToggle from '$components/ui/PairSkipToggle.svelte';
	import type { ParamGroup, SdDecision, SiteGroup } from '$lib/pairing/planGroups';
	import type { EntryFilter, EntryStatus, ReviewState } from '$lib/pairing/entryStatus';
	import {
		filterSelectionState,
		isSelected,
		selectedCount,
		type Selection,
	} from '$lib/pairing/selection';
	import { decisionGroups, decisionScopeLabel } from '$lib/pairing/decisionGroups';
	import type { BulkDecision } from '$lib/pairing/bulkActions';
	import { focusOnMount } from '$lib/focus';

	// The plan's Sites review tab: the plan by site, each group expanding to its streams. A site is
	// mapped to an existing one or created; the rows under it carry the per-stream decisions.
	let {
		planEntries,
		siteGroups,
		filteredGroups,
		pagedGroups,
		existingSites,
		expandedSites,
		expandedReplicates,
		existingParams,
		paramGroups,
		sdDisputedByParam,
		siteMetadataMap,
		editingParam = $bindable(),
		siteSearch = $bindable(),
		sitePage = $bindable(),
		totalSitePages,
		reviewFilter = $bindable(),
		editingSite = $bindable(),
		editValue = $bindable(),
		customParamInput = $bindable(),
		matchParam,
		newParamOption,
		parseNewParamOption,
		entryStatus,
		reviewState,
		reviewStateLabel,
		statusLabel,
		queueUpdate,
		setEntryAction,
		setEntryEstimator,
		setEntryAcknowledged,
		selection,
		ontoggleentry,
		onselectallinfilter,
		onclearselection,
		onselectdecision,
		labInstruments,
		onbulk,
		setSiteAction,
		toggleExpand,
		startEditSite,
		commitEditSite,
		renameSiteGlobal,
		mapSiteToExisting,
		goToParam,
		replicateChip,
		replicateRouting,
		valuesChip,
		streamPreview,
	}: {
		planEntries: PairingPlanEntry[];
		siteGroups: SiteGroup[];
		filteredGroups: SiteGroup[];
		/** The page of `filteredGroups` on screen. */
		pagedGroups: SiteGroup[];
		existingSites: Site[];
		expandedSites: Set<string>;
		/** Which replicate families are showing their members, keyed as the chips key them. */
		expandedReplicates: Set<string>;
		existingParams: Parameter[];
		paramGroups: ParamGroup[];
		/** The sd decision each parameter still owes, by parameter name. */
		sdDisputedByParam: Map<string, SdDecision>;
		siteMetadataMap: Map<string, SiteMetadata>;
		/** The stream whose parameter is being edited, or null. */
		editingParam: { site: string; streamId: string } | null;
		siteSearch: string;
		sitePage: number;
		totalSitePages: number;
		reviewFilter: EntryFilter;
		/** The site whose name is being edited, or null. */
		editingSite: string | null;
		editValue: string;
		/** The entry whose parameter is being typed by hand, keyed by stream id. */
		customParamInput: string | null;
		matchParam: (name: string) => Parameter | undefined;
		newParamOption: (name: string, units: string) => string;
		parseNewParamOption: (value: string) => { name: string; units: string | null };
		entryStatus: (entry: PairingPlanEntry) => EntryStatus;
		reviewState: (entry: PairingPlanEntry) => ReviewState;
		reviewStateLabel: Record<ReviewState, string>;
		statusLabel: (status: EntryStatus) => string;
		queueUpdate: (updates: PlanEntryUpdate[], opts?: { immediate?: boolean }) => void;
		setEntryAction: (entry: PairingPlanEntry, action: 'pair' | 'skip') => void;
		setEntryEstimator: (entry: PairingPlanEntry, value: SdEstimator | '') => void;
		setEntryAcknowledged: (entry: PairingPlanEntry, acknowledged: boolean) => void;
		/** The rows a bulk action is about. Held by the page so it survives a tab change. */
		selection: Selection;
		ontoggleentry: (entry: PairingPlanEntry) => void;
		onselectallinfilter: () => void;
		onclearselection: () => void;
		/** Take every row waiting on one question, which is what the grouping is for. */
		onselectdecision: (entries: PairingPlanEntry[]) => void;
		/** The lab instruments a selection can be pointed at in one action. */
		labInstruments: Array<{ id: string; name: string | null; serial_number: string | null }>;
		/** Apply one decision to every selected row, in one request. */
		onbulk: (decision: BulkDecision) => void;
		setSiteAction: (group: SiteGroup, action: 'pair' | 'skip') => void;
		toggleExpand: (siteName: string) => void;
		startEditSite: (siteName: string) => void;
		commitEditSite: () => void;
		renameSiteGlobal: (oldName: string, newName: string) => void;
		mapSiteToExisting: (oldName: string, existingSite: Site) => void;
		goToParam: (paramName: string) => void;
		/** The replicate marks, shared with the Parameters tab, so they are defined once. */
		replicateChip: Snippet<[string, PlanReplicateSummary, string]>;
		replicateRouting: Snippet<[PlanReplicateSummary, string]>;
		/** The preview handle and body a row without a replicate family carries instead. */
		valuesChip: Snippet<[string]>;
		streamPreview: Snippet<[string]>;
	} = $props();

	/** Whether the current filter's rows are all, some or none selected, for the header checkbox. */
	const headerState = $derived(filterSelectionState(selection, planEntries, reviewFilter));
	/** The questions the plan still poses, biggest first. Each is selectable whole. */
	const decisions = $derived(decisionGroups(planEntries));
	/** The instrument the bulk picker is pointing at. Cleared once the action is sent. */
	let bulkInstrument = $state('');
</script>

	<input
		type="text"
		placeholder="Search sites…"
		bind:value={siteSearch}
		oninput={() => sitePage = 0}
		class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
	/>

	<!-- What the plan is still waiting on, grouped by the question rather than by the row. A first
	     sync is a handful of questions repeated, and answering one of these answers every row under
	     it. -->
	{#if decisions.length > 0}
		<div class="flex flex-wrap items-center gap-1.5 text-xs">
			<span class="text-brand-muted">Waiting on:</span>
			{#each decisions as group (group.key)}
				<button
					onclick={() => onselectdecision(group.entries)}
					title="Select the {decisionScopeLabel(group)} waiting on this"
					class="px-2 py-0.5 rounded cursor-pointer border-none bg-severity-warning-soft text-severity-warning-text"
				>{group.label} ({group.entries.length})</button>
			{/each}
		</div>
	{/if}

	<div class="flex items-center justify-between gap-3">
		<div class="flex items-center gap-2 text-xs text-brand-muted">
			<!-- Select-all acts on the current filter, which is what makes a 1,679-row plan workable:
			     filter to the rows that share a problem, take them all, decide once. -->
			<input
				type="checkbox"
				checked={headerState === 'all'}
				indeterminate={headerState === 'some'}
				onchange={() => (headerState === 'all' ? onclearselection() : onselectallinfilter())}
				title="Select every row this filter shows"
				class="cursor-pointer"
				aria-label="Select every row this filter shows"
			/>
			<span>{filteredGroups.length} site{filteredGroups.length === 1 ? '' : 's'} ({planEntries.filter((e) => e.action === 'pair').length} streams to pair)</span>
			{#if selectedCount(selection) > 0}
				<span class="px-2 py-0.5 rounded bg-brand-primary text-white">{selectedCount(selection)} selected</span>
				<button
					onclick={onclearselection}
					class="cursor-pointer border-none bg-transparent text-brand-muted hover:text-brand-text underline"
				>clear</button>
			{/if}
		</div>
		<div class="flex gap-1">
			{#each [['all', 'All'], ['pair', 'Will pair'], ['skip', 'Skipped'], ['needs_checking', 'Needs checking'], ['self_validated', 'Self-validated'], ['unmatched', 'Unmatched'], ['warnings', 'With warnings']] as [val, label]}
				<button
					onclick={() => { reviewFilter = val as typeof reviewFilter; sitePage = 0; }}
					class="px-2 py-0.5 text-xs rounded cursor-pointer border-none {reviewFilter === val ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted hover:text-brand-text'}"
				>{label}</button>
			{/each}
		</div>
	</div>

	<!-- One decision over the chosen rows. The rows waiting on the same answer are a group above;
	     this is the answer, sent as one request rather than one per row. -->
	{#if selectedCount(selection) > 0}
		<div class="flex flex-wrap items-center gap-2 rounded-md border border-brand-divider bg-brand-bg px-3 py-2 text-xs">
			<span class="text-brand-muted">Apply to {selectedCount(selection)} selected:</span>
			<Button size="sm" onclick={() => onbulk({ field: 'action', value: 'pair' })}>Pair</Button>
			<Button size="sm" onclick={() => onbulk({ field: 'action', value: 'skip' })}>Skip</Button>
			<Button size="sm" onclick={() => onbulk({ field: 'acknowledged', value: true })}>Mark checked</Button>
			<Button size="sm" onclick={() => onbulk({ field: 'acknowledged', value: false })}>Unmark</Button>
			<select
				value=""
				onchange={(e) => {
					const value = e.currentTarget.value as SdEstimator | '';
					e.currentTarget.value = '';
					if (value) onbulk({ field: 'sd_estimator', value });
				}}
				aria-label="Standard deviation divisor for the selected rows"
				class="px-2 py-1 border border-brand-divider rounded bg-brand-surface"
			>
				<option value="">sd divisor…</option>
				<option value="sample">sample (n-1)</option>
				<option value="population">population (n)</option>
			</select>
			<select
				bind:value={bulkInstrument}
				onchange={() => {
					if (!bulkInstrument) return;
					onbulk({ field: 'instrument_id', value: bulkInstrument });
					bulkInstrument = '';
				}}
				aria-label="Instrument for the selected rows"
				class="px-2 py-1 border border-brand-divider rounded bg-brand-surface"
			>
				<option value="">instrument…</option>
				{#each labInstruments as s (s.id)}
					<option value={s.id}>{s.name || s.serial_number || s.id}</option>
				{/each}
			</select>
			<Button size="sm" onclick={() => onbulk({ field: 'instrument_clear' })}>Detach instrument</Button>
		</div>
	{/if}

	<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
		{#each pagedGroups as group}
			{@const allPair = group.pairCount === group.entries.length}
			{@const allSkip = group.skipCount === group.entries.length}
			{@const isExpanded = expandedSites.has(group.siteName)}
			{@const siteMatched = existingSites.find((s) => s.name.toLowerCase() === group.siteName.toLowerCase())}
			<div
				id="site-row-{group.siteName}"
				class="flex items-center border-b border-brand-divider hover:bg-brand-bg/50 {allSkip ? 'opacity-50' : ''}"
			>
				<button onclick={() => toggleExpand(group.siteName)} aria-label={isExpanded ? 'Collapse site group' : 'Expand site group'} class="px-3 py-2 bg-transparent border-none cursor-pointer text-brand-muted text-xs w-6">{isExpanded ? '▼' : '▶'}</button>
				<div class="flex-1 py-2 min-w-0">
					{#if editingSite === group.siteName}
						<input type="text" bind:value={editValue} onkeydown={(e) => { if (e.key === 'Enter') commitEditSite(); if (e.key === 'Escape') editingSite = null; }} onblur={commitEditSite} class="px-1 py-0.5 border border-brand-primary rounded text-sm bg-brand-surface w-48" use:focusOnMount />
					{:else}
						<select
							value={siteMatched ? `db:${siteMatched.id}` : `new:${group.siteName}`}
							onchange={(e) => {
								const val = (e.target as HTMLSelectElement).value;
								if (val === '__custom__') { startEditSite(group.siteName); return; }
								if (val.startsWith('db:')) {
									const es = existingSites.find((s) => s.id === val.slice(3));
									if (es) mapSiteToExisting(group.siteName, es);
								} else if (val.startsWith('new:')) {
									const newName = val.slice(4);
									if (newName !== group.siteName) renameSiteGlobal(group.siteName, newName);
								}
							}}
							class="px-1 py-0.5 rounded text-sm font-semibold bg-brand-surface border border-brand-divider max-w-[220px] {siteMatched ? 'border-severity-ok' : 'border-severity-warning'}"
						>
							<option value="__custom__">Custom name…</option>
							{#if existingSites.length > 0}
								<optgroup label="Existing sites">
									{#each existingSites as es}
										<option value="db:{es.id}">{es.name}</option>
									{/each}
								</optgroup>
							{/if}
							<optgroup label="Will be created">
								{#each siteGroups.filter((g) => !existingSites.some((es) => es.name.toLowerCase() === g.siteName.toLowerCase())) as newS}
									<option value="new:{newS.siteName}">+ {newS.siteName}</option>
								{/each}
							</optgroup>
						</select>
					{/if}
					<span class="text-xs text-brand-muted ml-2">{group.entries.length} params</span>
					{#if group.warningCount > 0}
						<span
							class="text-xs text-severity-warning ml-2"
							title={group.entries.flatMap((en) => en.warnings.map((w) => w.message)).join(', ')}
						>{group.warningCount} warn</span>
					{/if}
				</div>
				<span class="text-xs text-brand-muted px-2">{group.project}</span>
				<PairSkipToggle
					value={allPair ? 'pair' : allSkip ? 'skip' : 'mixed'}
					onchange={(a) => setSiteAction(group, a)}
					title="Pair or skip every parameter at {group.siteName}"
				/>
			</div>
			{#if isExpanded}
				{@const meta = siteMetadataMap.get(group.siteName)}
				{@const siteDevices = meta?.devices ?? []}
				{#if meta && (meta.full_name || meta.catchment || meta.glacier_name || meta.latitude || meta.elevation || siteDevices.length > 0)}
					<div class="pl-10 pr-2 py-2 border-b border-brand-divider bg-brand-primary/5 text-xs flex flex-wrap gap-x-5 gap-y-1 text-brand-muted">
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
				{#each group.entries as entry}
				{@const entryMatched = matchParam(entry.parameter.name)}
				{@const status = entryStatus(entry)}
				{@const entryEditing = editingParam?.streamId === entry.stream_id}
				{@const entryReplicates = entry.replicates}
					<div class="flex items-center gap-2 pl-10 pr-2 py-1.5 border-b border-brand-divider bg-brand-bg/30 text-xs {entry.action === 'skip' ? 'opacity-50' : ''}">
						<input
							type="checkbox"
							checked={isSelected(selection, entry)}
							onchange={() => ontoggleentry(entry)}
							class="cursor-pointer"
							aria-label="Select {entry.source_key}"
						/>
						<div class="flex-1 min-w-0 flex items-center gap-1.5">
							{#if entryEditing}
								{#if customParamInput !== null}
									<input
										type="text"
										bind:value={customParamInput}
										placeholder="New parameter name"
										class="px-1 py-0.5 rounded text-xs bg-brand-surface border border-brand-primary max-w-[180px]"
										use:focusOnMount
										onkeydown={(e) => {
											if (e.key === 'Enter' && customParamInput?.trim()) {
												const name = customParamInput.trim();
												entry.parameter.name = name;
												entry.parameter.create = true;
												planEntries = [...planEntries];
												queueUpdate([{ stream_id: entry.stream_id, parameter_name: name }]);
												customParamInput = null;
												editingParam = null;
											}
											if (e.key === 'Escape') { customParamInput = null; editingParam = null; }
										}}
									/>
									<button onclick={() => { customParamInput = null; }} class="text-[10px] text-brand-muted cursor-pointer bg-transparent border-none">cancel</button>
								{:else}
									<select
										value={entryMatched ? `db:${entryMatched.id}` : newParamOption(entry.parameter.name, entry.parameter.units)}
										onchange={(e) => {
											const val = (e.target as HTMLSelectElement).value;
											if (val === 'custom') {
												customParamInput = '';
												return;
											}
											editingParam = null;
											if (val.startsWith('db:')) {
												const ep = existingParams.find((p) => p.id === val.slice(3));
												if (ep && ep.code !== entry.parameter.name) {
													entry.parameter.name = ep.code;
													entry.parameter.create = false;
													planEntries = [...planEntries];
													queueUpdate([{ stream_id: entry.stream_id, parameter_name: ep.code }]);
												}
											} else if (val.startsWith('new:')) {
												const { name: newName, units: newUnits } = parseNewParamOption(val);
												const unitsChanged = newUnits !== null && newUnits !== entry.parameter.units;
												if (newName !== entry.parameter.name || unitsChanged) {
													entry.parameter.name = newName;
													entry.parameter.create = true;
													const update: PlanEntryUpdate = { stream_id: entry.stream_id, parameter_name: newName };
													if (unitsChanged) {
														entry.parameter.units = newUnits;
														update.parameter_units = newUnits as string;
													}
													planEntries = [...planEntries];
													queueUpdate([update]);
												}
											}
										}}
										class="px-1 py-0.5 rounded text-xs bg-brand-surface border border-brand-primary max-w-[220px]"
										use:focusOnMount
									>
										<optgroup label="Existing">
											{#each existingParams as ep}
												<option value="db:{ep.id}">{ep.name} ({ep.default_units})</option>
											{/each}
										</optgroup>
										<optgroup label="New">
											{#each paramGroups.filter((p) => !matchParam(p.name)) as newP}
												<option value={newParamOption(newP.name, newP.units)}>+ {newP.name} ({newP.units})</option>
											{/each}
										</optgroup>
										<option value="custom">Custom name…</option>
									</select>
								{/if}
							{:else}
								<button
									onclick={() => { editingParam = { site: group.siteName, streamId: entry.stream_id }; }}
									class="text-left bg-transparent border-none cursor-pointer text-brand-text hover:text-brand-primary"
									title="Change mapping for this site only"
								>
									{entry.parameter.name}
									<span class="text-brand-muted">({entry.parameter.units})</span>
								</button>
								<span class="px-1 py-0 rounded text-[10px] {entryMatched ? 'bg-severity-ok-soft text-severity-ok' : 'bg-severity-warning-soft text-severity-warning'}">{entryMatched ? 'existing' : 'new'}</span>
								<button
									onclick={() => goToParam(entry.parameter.name)}
									class="bg-transparent border-none cursor-pointer text-brand-muted hover:text-brand-primary text-[10px] ml-1"
									title="Edit this parameter for all sites"
								>edit all</button>
							{/if}
							{#if entryReplicates}
								{@render replicateChip(entry.stream_id, entryReplicates, entry.stream_id)}
							{:else}
								{@render valuesChip(entry.stream_id)}
							{/if}
						</div>
						<!-- Only where the divisor is still in question: a family nothing disputes
						     carries the sample declaration silently. -->
						{#if entryReplicates?.portal_sd_column && sdDisputedByParam.has(entry.parameter.name)}
							{@const declared = (entry as { sd_estimator?: SdEstimator | null }).sd_estimator ?? ''}
							<select
								value={declared}
								onchange={(e) => setEntryEstimator(entry, e.currentTarget.value as SdEstimator | '')}
								aria-label="Standard deviation formula for {entry.parameter.name}"
								title="Divisor for the sd computed from this family's replicates. The source ships its own {entryReplicates.portal_sd_column}; declare the one it used, or leave it undeclared and decide from the audit queue."
								class="px-1.5 py-0.5 rounded border text-[10px] shrink-0 cursor-pointer bg-brand-surface {declared ? 'border-brand-divider text-brand-text' : 'border-severity-warning-border text-severity-warning-text'}"
							>
								<option value="">sd: not declared</option>
								<option value="sample">sd: sample (n-1)</option>
								<option value="population">sd: population (n)</option>
							</select>
						{/if}
						<span
							class="px-1.5 py-0.5 rounded text-[10px] shrink-0 {status.matched ? 'bg-severity-ok-soft text-severity-ok' : 'bg-brand-bg text-brand-muted'}"
							title={status.matched
								? 'The catalog already holds this project, site and parameter'
								: `This plan creates: ${status.creates.join(', ') || 'nothing; the entry resolves to no slot'}`}
						>{status.matched ? '✓ matched' : statusLabel(status)}</span>
						<button
							onclick={() => setEntryAcknowledged(entry, reviewState(entry) !== 'acknowledged')}
							title={reviewState(entry) === 'acknowledged'
								? 'Checked by hand. Click to take that back.'
								: reviewState(entry) === 'self_validated'
									? 'Everything resolved and nothing warned, so this entry waits on nobody. Click to mark it checked anyway.'
									: 'Something did not resolve, or the entry warned. Click once you have looked at it.'}
							class="px-1.5 py-0.5 rounded text-[10px] shrink-0 cursor-pointer border-none {reviewState(entry) === 'acknowledged'
								? 'bg-severity-ok-soft text-severity-ok'
								: reviewState(entry) === 'self_validated'
									? 'bg-brand-bg text-brand-muted'
									: 'bg-severity-warning-soft text-severity-warning-text'}"
						>{reviewState(entry) === 'acknowledged' ? '✓ checked' : reviewStateLabel[reviewState(entry)]}</button>
						{#if status.warnings > 0}
							<span
								class="text-xs text-severity-warning shrink-0"
								title={entry.warnings.map((w) => w.message).join(', ')}
							>{status.warnings} warn ({status.warningKinds.join(', ')})</span>
						{/if}
						<PairSkipToggle
							size="sm"
							value={entry.action === 'pair' ? 'pair' : 'skip'}
							onchange={(a) => setEntryAction(entry, a)}
							title="Pair or skip this stream"
						/>
					</div>
					{#if expandedReplicates.has(entry.stream_id)}
						<div class="pl-12 pr-2 py-1.5 border-b border-brand-divider bg-brand-bg/30">
							{#if entryReplicates}
								{@render replicateRouting(entryReplicates, entry.stream_id)}
							{:else}
								{@render streamPreview(entry.stream_id)}
							{/if}
						</div>
					{/if}
				{/each}
			{/if}
		{/each}
		{#if pagedGroups.length === 0}
			<div class="px-4 py-8 text-center text-brand-muted text-sm">No sites match the current filter</div>
		{/if}
	</div>

	{#if totalSitePages > 1}
		<div class="flex items-center justify-between text-xs text-brand-muted">
			<span>Page {sitePage + 1} of {totalSitePages}</span>
			<div class="flex gap-1">
				<Button size="sm" onclick={() => sitePage = Math.max(0, sitePage - 1)} disabled={sitePage === 0}>Prev</Button>
				<Button size="sm" onclick={() => sitePage = Math.min(totalSitePages - 1, sitePage + 1)} disabled={sitePage >= totalSitePages - 1}>Next</Button>
			</div>
		</div>
	{/if}
