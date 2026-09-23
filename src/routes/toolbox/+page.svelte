<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import {
		createToolScript,
		getCalculationClosure,
		getCalculationHealth,
		listTools,
		listToolScripts,
		runEventRecompute,
		type CalculationHealth,
		type SlotCoverage,
		type ToolDescriptor,
		type ToolScriptSummary,
	} from '$api/service';
	import { api, type DerivedParameter, type Parameter } from '$api/crud';
	import { listAll } from '$api/paged';
	import {
		calculationRows,
		standingHealth,
		unconfiguredInputs,
		type CalculationRow,
	} from '$lib/calculations/rows';
	import {
		labelFollowingName,
		newCalculationRequest,
		type CalculationEngine,
	} from '$lib/toolbox/newCalculation';
	import { toolboxHref } from '$lib/toolbox/route';
	import { jobDetailPath } from '$lib/utils';
	import { AUTHOR_CALCULATIONS, authoringState, loadCatalog } from '$lib/toolbox/authoring';
	import { me } from '$auth/me.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import Button from '$components/ui/Button.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import CalculationFindings from '$components/tools/CalculationFindings.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';

	let formulas = $state<DerivedParameter[]>([]);
	let tools = $state<ToolDescriptor[]>([]);
	let scripts = $state<ToolScriptSummary[]>([]);
	let parameters = $state<Parameter[]>([]);
	let coverage = $state<SlotCoverage[]>([]);
	let health = $state<CalculationHealth[]>([]);
	let applying = $state<string | null>(null);
	let findingsOpen = $state<string | null>(null);
	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let refused = $state(false);
	let engineFilter = $state<'all' | 'formula' | 'script'>('all');

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
		calculationRows({ derived: formulas, tools, scripts, parameters, coverage, base }).filter(
			(r) => engineFilter === 'all' || r.engine === engineFilter
		)
	);
	const missingInputs = $derived(unconfiguredInputs(rows));
	/** Every calculation, whichever engine, including an R script with no version active yet,
	 *  which serves no output and so has no row in the table below. */
	const calculations = $derived(
		scripts.map((s) => ({
			...s,
			formulas: formulas.filter((f) => f.tool_script_id === s.id).length,
		}))
	);

	onMount(async () => {
		try {
			const [d, t, s, p, closure, h] = await Promise.all([
				listAll<DerivedParameter>(api.derivedParameters),
				listTools().catch(() => [] as ToolDescriptor[]),
				loadCatalog(listToolScripts),
				listAll<Parameter>(api.parameters),
				getCalculationClosure({ include_coverage: true }).catch(() => ({
					calculations: [],
					coverage: [],
				})),
				getCalculationHealth().catch(() => [] as CalculationHealth[]),
			]);
			formulas = d;
			tools = t;
			scripts = s.status === 'loaded' ? s.items : [];
			parameters = p;
			coverage = closure.coverage ?? [];
			health = h;
			// A finding chip on a reading opens its calculation's findings.
			const linked = page.url.searchParams.get('findings');
			if (linked) findingsOpen = rows.find((r) => r.calculation === linked)?.key ?? null;
			refused = s.status === 'refused';
			loadError = (s.status === 'failed' && s.message) || null;
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Failed to load calculations.';
		} finally {
			loading = false;
		}
	});

	const healthOf = $derived(new Map(health.map((h) => [h.tool, h])));

	/** The findings and the recompute standing against this row's calculation, if any. */
	function standing(row: CalculationRow): CalculationHealth | undefined {
		return standingHealth(healthOf.get(row.calculation));
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

	function inputTitle(row: CalculationRow): string {
		return row.inputs
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
		</div>
	</div>

	{#if loadError}
		<ErrorNotice message={loadError} />
	{:else if loading}
		<p class="text-sm text-brand-muted">Loading…</p>
	{:else}
		{#if !access.authorable}
			<p class="text-sm text-brand-muted">{access.notice}</p>
		{:else}
			<div class="rounded-md border border-brand-divider bg-brand-surface px-4 py-3 text-sm">
				<div class="flex items-center justify-between gap-3">
					<div>
						<p class="font-semibold">New calculation</p>
						<p class="text-brand-muted text-xs mt-0.5">
							A formula calculation is authored as tables of inputs, steps and outputs, over the
							parameters the formulas name. An R tool is a calculation with the R script engine,
							for what formulas cannot express: it defines <span class="font-mono">tool</span> in
							R. Either is authored on its own page.
						</p>
					</div>
					{#if !composing}
						<Button size="sm" onclick={() => (composing = true)}>New calculation</Button>
					{/if}
				</div>
				{#if composing}
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
				{/if}
			</div>
		{/if}

		{#if calculations.length > 0}
			<div class="rounded-md border border-brand-divider bg-brand-surface px-4 py-3 text-sm">
				<p class="font-semibold">Calculations</p>
				<ul class="mt-2 space-y-1">
					{#each calculations as calculation (calculation.id)}
						<li class="flex items-center justify-between gap-3">
							<span>
								{calculation.label || calculation.name}
								<Badge variant={calculation.engine === 'formula' ? 'muted' : 'accent'}>
									{calculation.engine === 'formula' ? 'formula' : 'R'}
								</Badge>
								<span class="text-brand-muted text-xs">
									{#if calculation.engine === 'formula'}
										{calculation.formulas} formula{calculation.formulas === 1 ? '' : 's'}
									{:else if calculation.active_version_no != null}
										version {calculation.active_version_no}
									{:else}
										no version active
									{/if}
								</span>
							</span>
							<a
								href={toolboxHref(base, calculation.id)}
								class="text-brand-primary no-underline hover:underline text-xs"
							>Edit</a>
						</li>
					{/each}
				</ul>
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

		<div class="overflow-x-auto rounded-md border border-brand-divider bg-brand-surface">
			<table class="w-full text-sm">
				<thead class="bg-brand-bg text-left">
					<tr class="border-b border-brand-divider">
						<th class="px-3 py-2 font-semibold">Output</th>
						<th class="px-3 py-2 font-semibold">Calculation</th>
						<th class="px-3 py-2 font-semibold">Engine</th>
						<th class="px-3 py-2 font-semibold">Inputs</th>
						<th class="px-3 py-2 font-semibold">Fires on</th>
						<th class="px-3 py-2 font-semibold text-right">Stored</th>
						<th class="px-3 py-2 font-semibold">From</th>
						<th class="px-3 py-2 font-semibold">Health</th>
						<th class="px-3 py-2 font-semibold">State</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as row (row.key)}
						<tr class="border-b border-brand-divider last:border-b-0">
							<td class="px-3 py-2 font-mono text-xs">{row.output_code}</td>
							<td class="px-3 py-2">
								<a href={row.href} class="text-brand-primary hover:underline">{row.label}</a>
							</td>
							<td class="px-3 py-2">
								<Badge variant={row.engine === 'script' ? 'accent' : 'muted'}>{row.engine}</Badge>
								<span class="ml-1.5 font-mono text-[11px] text-brand-muted">{row.definition}</span>
							</td>
							<td class="px-3 py-2 text-xs" title={inputTitle(row)}>
								{#if row.inputs.length === 0}
									<span class="text-brand-muted">-</span>
								{:else}
									{#each row.inputs as input, i}
										{#if i > 0}<span class="text-brand-muted">, </span>{/if}
										<span
											class="font-mono {input.unconfigured
												? 'text-severity-warning'
												: 'text-brand-text'}">{input.code}{input.unconfigured ? '!' : ''}</span
										>
									{/each}
								{/if}
							</td>
							<td class="px-3 py-2 text-xs text-brand-muted">{row.fires_on}</td>
							<td class="px-3 py-2 text-right font-mono text-xs">
								{row.output_reading_count ?? '-'}
							</td>
							<td class="px-3 py-2 text-xs text-brand-muted">
								{row.output_sources.length > 0 ? row.output_sources.join(', ') : '-'}
							</td>
							<td class="px-3 py-2">
								{#if standing(row)}
									{@const h = standing(row)!}
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
												aria-expanded={findingsOpen === row.key}
												onclick={() => (findingsOpen = findingsOpen === row.key ? null : row.key)}
											>Findings {findingsOpen === row.key ? '▾' : '▸'}</Button>
										{/if}
									</div>
								{:else}
									<span class="text-xs text-brand-muted">-</span>
								{/if}
							</td>
							<td class="px-3 py-2">
								{#if row.enabled === false}
									<Badge variant="muted">off</Badge>
								{:else if row.enabled === true}
									<Badge variant="ok">on</Badge>
								{:else}
									<span class="text-xs text-brand-muted">always</span>
								{/if}
							</td>
						</tr>
						{#if findingsOpen === row.key && standing(row)}
							<tr class="border-b border-brand-divider bg-brand-bg/40">
								<td colspan="9" class="px-3 py-2">
									<CalculationFindings
										calculation={standing(row)!.tool}
										onchange={async () => (health = await getCalculationHealth())}
									/>
								</td>
							</tr>
						{/if}
					{:else}
						<tr>
							<td colspan="9" class="px-3 py-6 text-center text-sm text-brand-muted">
								No calculations defined.
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
