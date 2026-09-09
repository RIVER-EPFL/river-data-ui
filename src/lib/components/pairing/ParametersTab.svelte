<script module lang="ts">
	/** Rows one page of the table holds, shared so a caller can turn to the page a row is on. */
	export const PARAM_ROWS_PER_PAGE = 25;
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	import type {
		PairingPlanEntry,
		PlanInstrumentGroup,
		PlanReplicateSummary,
		SdEstimator,
	} from '$api/service';
	import type { Parameter } from '$api/crud';
	import Button from '$components/ui/Button.svelte';
	import PairSkipToggle from '$components/ui/PairSkipToggle.svelte';
	import type { ParamGroup, SdDecision } from '$lib/pairing/planGroups';
	import { formatCount } from '$lib/format';

	// The plan's Parameters review tab: one row per parameter across every station that measures it,
	// so a decision taken here settles all of them at once.
	/** The instrument a parameter is bound to, as the Instruments tab decided it. */
	type ParamInstrument = {
		scope: string;
		anchorStreamId: string;
		suggestion: string;
		group: PlanInstrumentGroup | null;
	};

	/** One predicate the reviewer can apply to every row it matches, counted before it runs. */
	interface BulkActionOption {
		key: string;
		label: string;
		title: string;
		where: { confidence?: string; has_warnings?: boolean };
		action: 'pair' | 'skip';
		count: number;
	}

	let {
		paramGroups,
		siteCount,
		openInstrumentQuestions,
		bulkActions,
		bulkRunning,
		runBulkAction,
		deviceParameters,
		deviceSiteCount,
		instrumentByParameter,
		expandedParamGroups,
		expandedReplicates,
		groupStatus,
		rowWarnings,
		showDivisorHolds,
		setParamEstimator,
		goToInstrument,
		mapParamToExisting,
		renameGlobalParam,
		splitSourceToNewParam,
		startEditGlobalParam,
		commitEditGlobalParam,
		startEditUnits,
		commitEditUnits,
		editingGlobalParam = $bindable(),
		editValue = $bindable(),
		editingGlobalUnits = $bindable(),
		editUnitsValue = $bindable(),
		splitParamInput = $bindable(),
		splitParamValue = $bindable(),
		existingParams,
		sdDisputedByParam,
		estimatorScopeLabel,
		editingLabel = $bindable(),
		editLabelValue = $bindable(),
		matchParam,
		newParamOption,
		parseNewParamOption,
		startEditLabel,
		commitEditLabel,
		setParamGroupAction,
		ongoinstruments,
		replicateChip,
		replicateRouting,
		paramPage = $bindable(0),
	}: {
		paramGroups: ParamGroup[];
		/** How many sites the plan covers, which is the scope a change here applies over. */
		siteCount: number;
		openInstrumentQuestions: number;
		bulkActions: BulkActionOption[];
		/** The bulk action running, or null. */
		bulkRunning: string | null;
		runBulkAction: (option: BulkActionOption) => void;
		/** Parameters served by a device the source identifies by serial, which need no choice. */
		deviceParameters: Set<string>;
		deviceSiteCount: (parameter: string) => number;
		instrumentByParameter: Map<string, ParamInstrument>;
		expandedParamGroups: Set<string>;
		expandedReplicates: Set<string>;
		groupStatus: (pg: ParamGroup) => { total: number; unmatched: number; warnings: number };
		rowWarnings: (pg: ParamGroup) => string[];
		showDivisorHolds: (
			group: { paramName: string; entries: PairingPlanEntry[] },
			classification: 'population_sd' | 'not_population_sd',
		) => void;
		setParamEstimator: (group: { entries: PairingPlanEntry[] }, value: SdEstimator | '') => void;
		goToInstrument: (scope: string) => void;
		mapParamToExisting: (oldName: string, existingParam: Parameter) => void;
		renameGlobalParam: (oldName: string, newName: string, newUnits?: string) => void;
		splitSourceToNewParam: (sourceName: string, newParamName: string) => void;
		startEditGlobalParam: (name: string) => void;
		commitEditGlobalParam: () => void;
		startEditUnits: (paramName: string, currentUnits: string) => void;
		commitEditUnits: () => void;
		/** The parameter whose catalog name is being edited, or null. */
		editingGlobalParam: string | null;
		editValue: string;
		editingGlobalUnits: { name: string; units: string } | null;
		editUnitsValue: string;
		/** The source column being split onto a parameter of its own, or null. */
		splitParamInput: { groupName: string; sourceName: string } | null;
		splitParamValue: string;
		existingParams: Parameter[];
		/** The sd decision each parameter still owes, by parameter name. */
		sdDisputedByParam: Map<string, SdDecision>;
		estimatorScopeLabel: (entries: PairingPlanEntry[]) => string;
		/** The parameter whose plotting label is being edited, or null. */
		editingLabel: string | null;
		editLabelValue: string;
		matchParam: (name: string) => Parameter | undefined;
		newParamOption: (name: string, units: string) => string;
		parseNewParamOption: (value: string) => { name: string; units: string | null };
		startEditLabel: (pg: { name: string; label: string | null }) => void;
		commitEditLabel: () => void;
		setParamGroupAction: (pg: ParamGroup, action: 'pair' | 'skip') => void;
		/** Send the reviewer to the Instruments tab, which owns the instrument decision. */
		ongoinstruments: () => void;
		/** The replicate marks, shared with the Sites tab, so they are defined once. */
		replicateChip: Snippet<[string, PlanReplicateSummary, string]>;
		replicateRouting: Snippet<[PlanReplicateSummary, string]>;
		/** The page of parameter rows on show, held by the page so it can turn to a row. */
		paramPage: number;
	} = $props();

	function focusOnMount(node: HTMLInputElement) {
		node.focus();
	}

	// The Map-to dropdown offers the same two lists on every row, so the list of parameters this
	// plan would create is built once rather than filtered per row against the whole catalog.
	const createdGroups = $derived(paramGroups.filter((p) => !matchParam(p.name)));

	// A hundred rows each carrying a catalog-sized dropdown is tens of thousands of options in one
	// paint, so the rows are paged the way the Sites tab pages its own.
	const totalPages = $derived(Math.max(1, Math.ceil(paramGroups.length / PARAM_ROWS_PER_PAGE)));
	const page = $derived(Math.min(paramPage, totalPages - 1));
	const pagedGroups = $derived(
		paramGroups.slice(page * PARAM_ROWS_PER_PAGE, (page + 1) * PARAM_ROWS_PER_PAGE),
	);
</script>

	<div class="flex flex-wrap items-baseline gap-2">
		<p class="text-xs text-brand-muted">Map source parameters to existing DB parameters, rename, or change units. Changes apply across all {siteCount} sites.</p>
		{#if openInstrumentQuestions > 0}
			<button
				onclick={ongoinstruments}
				class="ml-auto text-xs text-severity-warning bg-transparent border-none p-0 cursor-pointer underline-offset-2 hover:underline"
			>{openInstrumentQuestions} instrument{openInstrumentQuestions === 1 ? '' : 's'} still to decide</button>
		{/if}
	</div>
	<!-- One predicate per button, counted from the same predicate before it runs, and
	     undone by its opposite. -->
	<div class="flex flex-wrap items-center gap-2">
		{#each bulkActions as b}
			<Button
				size="sm"
				variant="secondary"
				disabled={b.count === 0 || bulkRunning !== null}
				onclick={() => runBulkAction(b)}
				title={b.title}
			>{bulkRunning === b.key ? 'Working…' : `${b.label} (${formatCount(b.count)})`}</Button>
		{/each}
	</div>
	<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
		<table class="w-full text-sm">
			<thead><tr class="bg-brand-bg border-b border-brand-divider">
				<th class="text-left px-3 py-2 font-semibold">Source name</th>
				<th class="text-left px-3 py-2 font-semibold">Parameter name</th>
				<th class="text-left px-3 py-2 font-semibold">Units</th>
				<th class="text-left px-3 py-2 font-semibold">Decimals</th>
				<th class="text-left px-3 py-2 font-semibold w-[240px]">Map to</th>
				<th class="text-left px-3 py-2 font-semibold w-[260px]">Instrument</th>
				<th class="text-left px-3 py-2 font-semibold">Status</th>
				<th class="text-right px-3 py-2 font-semibold">Sites</th>
				<th class="text-right px-3 py-2 font-semibold">Everywhere</th>
			</tr></thead>
			<tbody>
				{#each pagedGroups as pg}
					{@const matched = matchParam(pg.name)}
					{@const sd = sdDisputedByParam.get(pg.name)}
					{@const status = groupStatus(pg)}
					<tr
						id="param-row-{pg.name}"
						class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50 transition-shadow {sd ? (sd.declared ? 'bg-severity-ok-soft' : 'bg-severity-warning-soft') : ''}"
					>
						<td class="px-3 py-2 text-xs text-brand-muted font-mono max-w-[250px]">
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
													autofocus
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
					</td>
						<td class="px-3 py-2">
							{#if matched}
								<span class="font-medium text-brand-text font-mono" title="Already exists in the database - edit via the Parameters page">{matched.code ?? matched.name}</span>
							{:else if editingGlobalParam === pg.name}
								<input type="text" bind:value={editValue} onkeydown={(e) => { if (e.key === 'Enter') commitEditGlobalParam(); if (e.key === 'Escape') editingGlobalParam = null; }} onblur={commitEditGlobalParam} class="px-1 py-0.5 border border-brand-primary rounded text-sm bg-brand-surface w-40" autofocus />
							{:else}
								<button onclick={() => startEditGlobalParam(pg.name)} class="bg-transparent border-0 border-b border-dashed border-brand-muted cursor-pointer text-brand-text hover:text-brand-primary hover:border-brand-primary text-left font-medium font-mono">{pg.name}</button>
							{/if}
							{#if matched}
								{#if pg.label}
									<div class="text-xs text-brand-muted mt-0.5">{pg.label}</div>
								{/if}
							{:else if editingLabel === pg.name}
								<input
									type="text"
									bind:value={editLabelValue}
									onkeydown={(e) => { if (e.key === 'Enter') commitEditLabel(); if (e.key === 'Escape') editingLabel = null; }}
									onblur={commitEditLabel}
									placeholder="Display label"
									class="mt-0.5 px-1 py-0.5 border border-brand-primary rounded text-xs bg-brand-surface w-40"
									use:focusOnMount
								/>
							{:else}
								<button
									onclick={() => startEditLabel(pg)}
									class="block bg-transparent border-0 border-b border-dashed border-brand-muted cursor-pointer text-xs text-brand-muted hover:text-brand-primary hover:border-brand-primary mt-0.5 text-left"
									title="Display label for the created parameter; the code stays the source column name"
								>{pg.label ?? 'Add display label'}</button>
							{/if}
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
							{#if sd}
								{@const unexplained = sd.holds - sd.population}
								<div class="mt-1 flex items-center gap-2 text-[11px]">
									<select
										value={sd.declared}
										onchange={(e) => setParamEstimator(sd, e.currentTarget.value as SdEstimator | '')}
										aria-label="Standard deviation divisor for {pg.name}"
										title="The divisor the sd computed from this family's replicates uses. The source ships its own; declare the one it used."
										class="px-1 py-0.5 rounded border text-[11px] cursor-pointer bg-brand-surface {sd.declared ? 'border-brand-divider text-brand-text' : 'border-severity-warning-border text-severity-warning-text'}"
									>
										<option value="">sd: not declared</option>
										<option value="sample">sd: sample (n-1)</option>
										<option value="population">sd: population (n)</option>
									</select>
									<span class="text-brand-muted">writes {estimatorScopeLabel(sd.entries)}</span>
									<span class="text-brand-muted">
										{#if sd.population > 0}
											<button
												onclick={() => showDivisorHolds(sd, 'population_sd')}
												class="bg-transparent border-none p-0 cursor-pointer text-brand-primary underline-offset-2 hover:underline"
												title="Open these holds in the audit queue"
											>{sd.population} incoming sd match population (n)</button>
										{/if}
										{#if unexplained > 0}
											{sd.population > 0 ? ', ' : ''}
											<button
												onclick={() => showDivisorHolds(sd, 'not_population_sd')}
												class="bg-transparent border-none p-0 cursor-pointer text-brand-primary underline-offset-2 hover:underline"
												title="Open these holds in the audit queue"
											>{unexplained} match neither</button>
										{/if}
										{#if sd.holds === 0}divisor differs between this parameter's streams{/if}
									</span>
								</div>
							{/if}
							{#if rowWarnings(pg).length > 0}
								<div class="text-xs text-severity-warning mt-0.5">{rowWarnings(pg)[0]}</div>
							{/if}
						</td>
						<td class="px-3 py-2 text-xs">
							{#if matched}
								<span class="text-brand-muted" title="Already exists in the database - edit via the Parameters page">{matched.default_units}</span>
							{:else if editingGlobalUnits?.name === pg.name && editingGlobalUnits?.units === pg.units}
								<input type="text" bind:value={editUnitsValue} onkeydown={(e) => { if (e.key === 'Enter') commitEditUnits(); if (e.key === 'Escape') editingGlobalUnits = null; }} onblur={commitEditUnits} class="px-1 py-0.5 border border-brand-primary rounded text-xs bg-brand-surface w-20" autofocus />
							{:else}
								<button onclick={() => startEditUnits(pg.name, pg.units)} class="bg-transparent border-0 border-b border-dashed border-brand-muted cursor-pointer text-brand-muted hover:text-brand-primary hover:border-brand-primary">{pg.units || '--'}</button>
							{/if}
						</td>
						<!-- The precision the apply writes onto a slot that declares none, which is what
						     every published value of it is then expressed at. -->
						<td class="px-3 py-2 text-xs">
							{#if pg.decimalPlacesMixed}
								<span class="text-severity-warning" title="This parameter's streams declare different precisions; each slot takes its own.">mixed</span>
							{:else if pg.decimalPlaces !== null}
								<span title="Declared by the source. Written onto a slot that declares none; an operator's declaration is never overwritten.">{pg.decimalPlaces}</span>
							{:else}
								<span class="text-brand-muted" title="The source declares no precision, so the slot publishes values as stored.">as stored</span>
							{/if}
						</td>
						<td class="px-4 py-2">
							<select
								value={matched ? `db:${matched.id}` : newParamOption(pg.name, pg.units)}
								onchange={(e) => {
									const val = (e.target as HTMLSelectElement).value;
									if (val.startsWith('db:')) {
										const ep = existingParams.find((p) => p.id === val.slice(3));
										if (ep) mapParamToExisting(pg.name, ep);
									} else if (val.startsWith('new:')) {
										const { name: newName, units: newUnits } = parseNewParamOption(val);
										if (newName !== pg.name || (newUnits !== null && newUnits !== pg.units)) {
											renameGlobalParam(pg.name, newName, newUnits ?? undefined);
										}
									}
								}}
								class="px-2 py-1 rounded text-xs bg-brand-surface w-full max-w-[220px] border border-brand-divider {matched ? 'border-severity-ok' : 'border-severity-warning'}"
							>
								<optgroup label="Existing parameters">
									{#each existingParams as ep}
										<option value="db:{ep.id}">{ep.name} ({ep.default_units})</option>
									{/each}
								</optgroup>
								<optgroup label="Will be created">
									{#each createdGroups as newP}
										<option value={newParamOption(newP.name, newP.units)}>+ {newP.name} ({newP.units})</option>
									{/each}
								</optgroup>
							</select>
						</td>
						<!-- A mirror of the decision, not a second editor: one instrument
						     decision covers every site a parameter arrives at, and two
						     controls over it are how they come to disagree. -->
						<td class="px-4 py-2">
							{#if instrumentByParameter.get(pg.name)}
								{@const inst = instrumentByParameter.get(pg.name)!}
								<button
									onclick={() => goToInstrument(inst.scope)}
									class="text-left bg-transparent border-0 border-b border-dashed border-brand-muted cursor-pointer hover:text-brand-primary hover:border-brand-primary {inst.group ? 'text-brand-text' : 'text-severity-warning italic'}"
									title="Choose the instrument for this parameter"
								>{inst.group?.name ?? inst.suggestion}</button>
								<div class="text-[11px] text-brand-muted mt-0.5">
									{#if !inst.group}not chosen yet
									{:else if inst.group.create}will be created
									{:else}existing instrument{/if}
								</div>
							{:else if deviceParameters.has(pg.name)}
								{@const n = deviceSiteCount(pg.name)}
								<button
									onclick={ongoinstruments}
									class="text-left bg-transparent border-0 border-b border-dashed border-brand-muted cursor-pointer text-brand-text hover:text-brand-primary hover:border-brand-primary"
									title="This parameter's instrument is the device at each site"
								>a device at {n} site{n === 1 ? '' : 's'}</button>
								<div class="text-[11px] text-brand-muted mt-0.5">attached from its serial</div>
							{:else}
								<span class="text-xs text-brand-muted">--</span>
							{/if}
						</td>
						<!-- Whether the parameter itself is known, and what the entries under
						     it still create. The same status the site rows carry, summed. -->
						<td class="px-4 py-2">
							<span class="text-xs px-1.5 py-0.5 rounded {matched ? 'bg-severity-ok-soft text-severity-ok' : 'bg-severity-warning-soft text-severity-warning'}">{matched ? 'existing' : 'new'}</span>
							{#if status.unmatched > 0}
								<div class="text-[11px] text-brand-muted mt-0.5" title="Entries under this parameter whose project, site or parameter this plan would create">
									{status.unmatched} of {status.total} unmatched
								</div>
							{:else}
								<div class="text-[11px] text-severity-ok mt-0.5">all {status.total} matched</div>
							{/if}
							{#if status.warnings > 0}
								<div class="text-[11px] text-severity-warning mt-0.5">{status.warnings} with warnings</div>
							{/if}
						</td>
						<td class="px-4 py-2 text-right text-brand-muted">{pg.siteCount}</td>
						<td class="px-4 py-2 text-right whitespace-nowrap">
							<div class="inline-flex justify-end w-full">
								<PairSkipToggle
									value={pg.pairCount === pg.streamIds.length
										? 'pair'
										: pg.pairCount === 0
											? 'skip'
											: 'mixed'}
									onchange={(a) => setParamGroupAction(pg, a)}
									title="Pair or skip {pg.name} at every station"
								/>
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	{#if totalPages > 1}
		<div class="flex items-center justify-between text-xs text-brand-muted">
			<span>Page {page + 1} of {totalPages}, {formatCount(paramGroups.length)} parameters</span>
			<div class="flex gap-1">
				<Button size="sm" onclick={() => paramPage = Math.max(0, page - 1)} disabled={page === 0}>Prev</Button>
				<Button size="sm" onclick={() => paramPage = Math.min(totalPages - 1, page + 1)} disabled={page >= totalPages - 1}>Next</Button>
			</div>
		</div>
	{/if}
