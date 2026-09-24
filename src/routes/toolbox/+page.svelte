<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import {
		createToolScript,
		getCalculationClosure,
		getCalculationHealth,
		getCalculationSites,
		listTools,
		listToolScripts,
		runEventRecompute,
		type CalculationHealth,
		type CalculationSites,
		type SlotCoverage,
		type ToolDescriptor,
		type ToolScriptSummary,
	} from '$api/service';
	import { api, type DerivedParameter, type Parameter } from '$api/crud';
	import { listAll } from '$api/paged';
	import {
		calculationRows,
		janitorFillLine,
		standingHealth,
		unconfiguredInputs,
	} from '$lib/calculations/rows';
	import {
		calculationEntries,
		isListed,
		matchesSearch,
		type CalculationEntry,
	} from '$lib/toolbox/calculations';
	import {
		labelFollowingName,
		newCalculationRequest,
		type CalculationEngine,
	} from '$lib/toolbox/newCalculation';
	import { siteCalculationHref, toolboxHref } from '$lib/toolbox/route';
	import { formatDate, jobDetailPath } from '$lib/utils';
	import { AUTHOR_CALCULATIONS, authoringState, loadCatalog } from '$lib/toolbox/authoring';
	import { me } from '$auth/me.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import Button from '$components/ui/Button.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import CalculationFindings from '$components/tools/CalculationFindings.svelte';
	import DecommissionCalculation from '$components/toolbox/DecommissionCalculation.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';

	let formulas = $state<DerivedParameter[]>([]);
	let tools = $state<ToolDescriptor[]>([]);
	let scripts = $state<ToolScriptSummary[]>([]);
	let parameters = $state<Parameter[]>([]);
	let coverage = $state<SlotCoverage[]>([]);
	let health = $state<CalculationHealth[]>([]);
	let applied = $state<CalculationSites[]>([]);
	let applying = $state<string | null>(null);
	let findingsOpen = $state<string | null>(null);
	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let refused = $state(false);
	let engineFilter = $state<'all' | 'formula' | 'script'>('all');
	let showDecommissioned = $state(false);
	let search = $state('');
	let expanded = $state<string | null>(null);
	let sitesOpen = $state<string | null>(null);

	// A new calculation. The engine is chosen here because it is a property of the calculation; a
	// parameter group is not one of its properties (Q169).
	let composing = $state(false);
	let newEngine = $state<CalculationEngine>('formula');
	let newName = $state('');
	let newLabel = $state('');
	let labelEdited = $state(false);
	let creating = $state(false);
	const access = $derived(
		authoringState({ permitted: me.can(AUTHOR_CALCULATIONS), refused })
	);

	async function createCalculation() {
		const made = newCalculationRequest({ name: newName, label: newLabel, engine: newEngine });
		if ('error' in made) {
			toastStore.error(made.error);
			return;
		}
		creating = true;
		try {
			const created = await createToolScript(made.request);
			await goto(toolboxHref(base, created.id));
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'The calculation was not created.');
		} finally {
			creating = false;
		}
	}

	const rows = $derived(
		calculationRows({ derived: formulas, tools, scripts, parameters, coverage, base })
	);
	const missingInputs = $derived(unconfiguredInputs(rows));
	const entries = $derived(
		calculationEntries(rows, scripts, base, applied).filter(
			(e) =>
				(engineFilter === 'all' || e.engine === engineFilter) &&
				isListed(e, showDecommissioned) &&
				matchesSearch(e, search)
		)
	);

	onMount(async () => {
		try {
			const [d, t, s, p, closure, h, a] = await Promise.all([
				listAll<DerivedParameter>(api.derivedParameters),
				listTools().catch(() => [] as ToolDescriptor[]),
				loadCatalog(listToolScripts),
				listAll<Parameter>(api.parameters),
				getCalculationClosure({ include_coverage: true }).catch(() => ({
					calculations: [],
					coverage: [],
				})),
				getCalculationHealth().catch(() => [] as CalculationHealth[]),
				getCalculationSites().catch(() => [] as CalculationSites[]),
			]);
			formulas = d;
			tools = t;
			scripts = s.status === 'loaded' ? s.items : [];
			parameters = p;
			coverage = closure.coverage ?? [];
			health = h;
			applied = a;
			// A finding chip on a reading opens its calculation's findings.
			const linked = page.url.searchParams.get('findings');
			if (linked) findingsOpen = linked;
			refused = s.status === 'refused';
			loadError = (s.status === 'failed' && s.message) || null;
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Failed to load calculations.';
		} finally {
			loading = false;
		}
	});

	const healthOf = $derived(new Map(health.map((h) => [h.tool, h])));
	// The sites a line about the janitor names, from the sites each calculation fires at.
	const siteNames = $derived(
		new Map(entries.flatMap((e) => e.sites ?? []).map((s) => [s.id, s.name])),
	);

	/** The findings and the recompute standing against this calculation, if any. */
	function standing(entry: CalculationEntry): CalculationHealth | undefined {
		return standingHealth(healthOf.get(entry.calculation));
	}

	function healthTitle(h: CalculationHealth): string {
		return [
			`${h.stale_outputs} stale output${h.stale_outputs === 1 ? '' : 's'}`,
			`${h.missing_outputs} missing`,
			`${h.skipped_outputs} skipped`,
		].join(', ');
	}

	/// The apply C22 deferred to M24: the scoped recompute, held to the visits this calculation
	/// has findings on.
	async function applyStale(calculation: string, visits: number) {
		applying = calculation;
		try {
			await runEventRecompute({ only_findings: true, calculation });
			toastStore.success(
				`Recomputing ${calculation} at ${visits} visit${visits === 1 ? '' : 's'}`
			);
			health = await getCalculationHealth();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'The recompute was not queued.');
		} finally {
			applying = null;
		}
	}

	/** Reread the calculations after one is switched, with the sites it now fires at. */
	async function refreshScripts() {
		const [s, a] = await Promise.all([
			loadCatalog(listToolScripts),
			getCalculationSites().catch(() => applied),
		]);
		if (s.status === 'loaded') scripts = s.items;
		applied = a;
	}

	function inputTitle(entry: CalculationEntry): string {
		return entry.inputs
			.map((i) =>
				i.unconfigured
					? `${i.code}: no site configures it`
					: `${i.code}${i.reading_count != null ? `: ${i.reading_count} readings` : ''}`
			)
			.join('\n');
	}
</script>

<svelte:head><title>Toolbox | RIVER Data</title></svelte:head>

<div class="space-y-4">
	<div class="flex items-center justify-between gap-3 flex-wrap">
		<div>
			<h1 class="text-xl font-semibold">Toolbox</h1>
			<p class="text-sm text-brand-muted">
				Every calculation: input parameters in, output parameters out, re-run at a visit when an
				input changes. The engine is a property of the calculation, a formula or an R script,
				and Edit opens its formulas or its script.
			</p>
			{#if !loading && !loadError && access.authorable}
				<Button variant="primary" class="mt-3" onclick={() => (composing = true)}>
					New calculation
				</Button>
			{/if}
		</div>
		<div class="flex items-center gap-1.5 text-xs">
			{#each [['all', 'All'], ['formula', 'Formulas'], ['script', 'Scripts']] as [value, label]}
				<button
					class="cursor-pointer rounded-md border px-2 py-1 {engineFilter === value
						? 'border-brand-primary bg-brand-primary/10 text-brand-primary'
						: 'border-brand-divider bg-brand-surface text-brand-muted'}"
					onclick={() => (engineFilter = value as typeof engineFilter)}
				>{label}</button>
			{/each}
			<label class="ml-2 inline-flex items-center gap-1 text-brand-muted">
				<input type="checkbox" bind:checked={showDecommissioned} />
				Show decommissioned
			</label>
		</div>
	</div>

	{#if loadError}
		<ErrorNotice message={loadError} />
	{:else if loading}
		<p class="text-sm text-brand-muted">Loading…</p>
	{:else}
		{#if !access.authorable}
			<p class="text-sm text-brand-muted">{access.notice}</p>
		{:else if composing}
			<div class="rounded-md border border-brand-divider bg-brand-surface px-4 py-3 text-sm">
				<p class="font-semibold">New calculation</p>
				<p class="text-brand-muted text-xs mt-0.5">
					A formula calculation is authored as tables of inputs, steps and outputs, over the
					parameters the formulas name. An R tool is a calculation with the R script engine, for
					what formulas cannot express: it defines <span class="font-mono">tool</span> in R.
					Either is authored on its own page.
				</p>
				<div class="mt-3 flex flex-wrap items-end gap-2">
					<label class="text-xs text-brand-muted">
						Engine
						<select
							bind:value={newEngine}
							class="block mt-0.5 px-2 py-1 rounded border border-brand-divider bg-brand-surface text-sm text-brand-text"
						>
							<option value="formula">Formulas</option>
							<option value="script">R script</option>
						</select>
					</label>
					<label class="text-xs text-brand-muted">
						Name
						<input
							value={newName}
							oninput={(e) => {
								newName = (e.target as HTMLInputElement).value;
								newLabel = labelFollowingName({ value: newLabel, edited: labelEdited }, newName);
							}}
							placeholder="pco2"
							class="block mt-0.5 px-2 py-1 rounded border border-brand-divider bg-brand-surface text-sm text-brand-text w-40"
						/>
					</label>
					<label class="text-xs text-brand-muted">
						Label
						<input
							value={newLabel}
							oninput={(e) => {
								newLabel = (e.target as HTMLInputElement).value;
								labelEdited = true;
							}}
							placeholder="pCO2"
							class="block mt-0.5 px-2 py-1 rounded border border-brand-divider bg-brand-surface text-sm text-brand-text w-40"
						/>
					</label>
					<Button size="sm" onclick={createCalculation} disabled={creating}
						>{creating ? 'Creating…' : 'Create and open it'}</Button
					>
					<Button size="sm" variant="ghost" onclick={() => (composing = false)}>Cancel</Button>
				</div>
			</div>
		{/if}

		{#if missingInputs.length > 0}
			<div
				class="rounded-md border border-severity-warning-border bg-severity-warning-soft px-4 py-2.5 text-sm text-severity-warning-text"
			>
				{missingInputs.length} calculation input{missingInputs.length === 1 ? '' : 's'} no site
				configures, so nothing can fire on {missingInputs.length === 1 ? 'it' : 'them'}:
				<span class="font-mono">{missingInputs.join(', ')}</span>
			</div>
		{/if}

		<input
			type="search"
			bind:value={search}
			aria-label="Search calculations"
			placeholder="Search by name, output or input code"
			class="w-full max-w-sm px-2 py-1 rounded border border-brand-divider bg-brand-surface text-sm text-brand-text"
		/>

		<div class="overflow-x-auto rounded-md border border-brand-divider bg-brand-surface">
			<table class="w-full text-sm">
				<thead class="bg-brand-bg text-left">
					<tr class="border-b border-brand-divider">
						<th class="px-3 py-2 font-semibold">Calculation</th>
						<th class="px-3 py-2 font-semibold">Engine</th>
						<th class="px-3 py-2 font-semibold">Outputs</th>
						<th class="px-3 py-2 font-semibold">Inputs</th>
						<th class="px-3 py-2 font-semibold">Fires on</th>
						<th class="px-3 py-2 font-semibold">Sites</th>
						<th class="px-3 py-2 font-semibold text-right">Stored</th>
						<th class="px-3 py-2 font-semibold">Health</th>
						<th class="px-3 py-2 font-semibold">State</th>
					</tr>
				</thead>
				<tbody>
					{#each entries as entry (entry.calculation)}
						<tr class="border-b border-brand-divider last:border-b-0">
							<td class="px-3 py-2">
								<a href={entry.href} class="text-brand-primary hover:underline">{entry.label}</a>
								<span class="block font-mono text-[11px] text-brand-muted">{entry.calculation}</span>
							</td>
							<td class="px-3 py-2">
								<Badge variant={entry.engine === 'script' ? 'accent' : 'muted'}>
									{entry.engine === 'script' ? 'R' : 'formula'}
								</Badge>
							</td>
							<td class="px-3 py-2 text-xs">
								{#if entry.outputs.length === 0}
									<span class="text-brand-muted">none</span>
								{:else}
									<button
										class="cursor-pointer text-left"
										aria-expanded={expanded === entry.calculation}
										title="Each output's formula, stored count and source"
										onclick={() =>
											(expanded = expanded === entry.calculation ? null : entry.calculation)}
									>
										<span class="font-mono">{entry.outputs.map((o) => o.output_code).join(', ')}</span>
										<span class="text-brand-muted">{expanded === entry.calculation ? '▾' : '▸'}</span>
									</button>
								{/if}
							</td>
							<td class="px-3 py-2 text-xs" title={inputTitle(entry)}>
								{#if entry.inputs.length === 0}
									<span class="text-brand-muted">-</span>
								{:else}
									{#each entry.inputs as input, i}
										{#if i > 0}<span class="text-brand-muted">, </span>{/if}
										<span
											class="font-mono {input.unconfigured
												? 'text-severity-warning'
												: 'text-brand-text'}">{input.code}{input.unconfigured ? '!' : ''}</span
										>
									{/each}
								{/if}
							</td>
							<td class="px-3 py-2 text-xs text-brand-muted">{entry.fires_on}</td>
							<td class="px-3 py-2 text-xs">
								{#if entry.sites === null}
									<span class="text-brand-muted">-</span>
								{:else if entry.sites.length === 0}
									<span class="text-brand-muted">none</span>
								{:else}
									<button
										class="cursor-pointer text-brand-primary hover:underline"
										aria-expanded={sitesOpen === entry.calculation}
										title="The sites this calculation fires at"
										onclick={() =>
											(sitesOpen = sitesOpen === entry.calculation ? null : entry.calculation)}
									>
										{entry.sites.length} site{entry.sites.length === 1 ? '' : 's'}
										<span class="text-brand-muted">{sitesOpen === entry.calculation ? '▾' : '▸'}</span>
									</button>
								{/if}
							</td>
							<td class="px-3 py-2 text-right font-mono text-xs">{entry.stored ?? '-'}</td>
							<td class="px-3 py-2">
								{#if standing(entry)}
									{@const h = standing(entry)!}
									<div class="flex items-center gap-1.5">
										{#if h.repair}
											<a href="{base}{jobDetailPath(h.repair.job_id)}" class="no-underline" title="The latest recompute of this calculation">
												<Badge variant={h.repair.state === 'failed' ? 'alarm' : 'muted'}>
													{h.repair.state === 'failed' ? 'recompute failed' : `recompute ${h.repair.state}`}
												</Badge>
											</a>
										{/if}
										{#if h.stale_visits > 0}
											<Badge variant="warning" title={healthTitle(h)}>
												{h.stale_visits} stale visit{h.stale_visits === 1 ? '' : 's'}
											</Badge>
											<Button
												size="sm"
												variant="secondary"
												disabled={applying === h.tool}
												onclick={() => applyStale(h.tool, h.stale_visits)}
											>{applying === h.tool ? 'Queueing…' : 'Recompute them'}</Button>
											<Button
												size="sm"
												variant="ghost"
												aria-expanded={findingsOpen === entry.calculation}
												onclick={() =>
													(findingsOpen = findingsOpen === entry.calculation ? null : entry.calculation)}
											>Findings {findingsOpen === entry.calculation ? '▾' : '▸'}</Button>
										{/if}
									</div>
									{#if janitorFillLine(h, siteNames)}
										<p class="mt-1 text-xs text-severity-warning" role="status">
											{janitorFillLine(h, siteNames)}: a write missed its recompute.
										</p>
									{/if}
								{:else}
									<span class="text-xs text-brand-muted">-</span>
								{/if}
							</td>
							<td class="px-3 py-2">
								<div class="flex flex-wrap items-center gap-1.5">
									{#if entry.versionless}
										<Badge variant="muted">no version active</Badge>
									{/if}
									{#if entry.decommissioned_at}
										<Badge variant="muted">decommissioned {formatDate(entry.decommissioned_at)}</Badge>
									{:else if access.authorable && entry.id && me.can('admin')}
										<DecommissionCalculation id={entry.id} onchanged={refreshScripts} />
									{/if}
								</div>
							</td>
						</tr>
						{#if expanded === entry.calculation}
							<tr class="border-b border-brand-divider bg-brand-bg/40">
								<td colspan="9" class="px-3 py-2">
									<table class="w-full text-xs">
										<thead class="text-left text-brand-muted">
											<tr>
												<th class="px-2 py-1 font-semibold">Output</th>
												<th class="px-2 py-1 font-semibold">{entry.engine === 'script' ? 'Version' : 'Formula'}</th>
												<th class="px-2 py-1 font-semibold text-right">Stored</th>
												<th class="px-2 py-1 font-semibold">From</th>
											</tr>
										</thead>
										<tbody>
											{#each entry.outputs as output (output.key)}
												<tr>
													<td class="px-2 py-1 font-mono">{output.output_code}</td>
													<td class="px-2 py-1 font-mono text-brand-muted">{output.definition}</td>
													<td class="px-2 py-1 text-right font-mono">{output.output_reading_count ?? '-'}</td>
													<td class="px-2 py-1 text-brand-muted">
														{output.output_sources.length > 0 ? output.output_sources.join(', ') : '-'}
													</td>
												</tr>
											{/each}
										</tbody>
									</table>
								</td>
							</tr>
						{/if}
						{#if sitesOpen === entry.calculation && entry.sites}
							<tr class="border-b border-brand-divider bg-brand-bg/40">
								<td colspan="9" class="px-3 py-2 text-xs">
									Fires at
									{#each entry.sites as site, i (site.id)}
										{#if i > 0}<span class="text-brand-muted"> · </span>{/if}
										<a
											class="text-brand-primary hover:underline"
											href={siteCalculationHref(base, site.id, entry.calculation)}
										>{site.name}</a>
									{/each}
								</td>
							</tr>
						{/if}
						{#if findingsOpen === entry.calculation && standing(entry)}
							<tr class="border-b border-brand-divider bg-brand-bg/40">
								<td colspan="9" class="px-3 py-2">
									<CalculationFindings
										calculation={standing(entry)!.tool}
										onchange={async () => (health = await getCalculationHealth())}
									/>
								</td>
							</tr>
						{/if}
					{:else}
						<tr>
							<td colspan="9" class="px-3 py-6 text-center text-sm text-brand-muted">
								{search.trim() ? 'No calculation matches the search.' : 'No calculations defined.'}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
