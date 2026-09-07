<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import {
		getCalculationClosure,
		listTools,
		listToolScripts,
		type SlotCoverage,
		type ToolDescriptor,
		type ToolScriptSummary,
	} from '$api/service';
	import { api, type DerivedParameter, type Parameter } from '$api/crud';
	import { listAll } from '$api/paged';
	import { calculationRows, unconfiguredInputs, type CalculationRow } from '$lib/calculations/rows';
	import Badge from '$components/ui/Badge.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';

	let formulas = $state<DerivedParameter[]>([]);
	let tools = $state<ToolDescriptor[]>([]);
	let scripts = $state<ToolScriptSummary[]>([]);
	let parameters = $state<Parameter[]>([]);
	let coverage = $state<SlotCoverage[]>([]);
	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let engineFilter = $state<'all' | 'formula' | 'script'>('all');

	const rows = $derived(
		calculationRows({ derived: formulas, tools, scripts, parameters, coverage, base }).filter(
			(r) => engineFilter === 'all' || r.engine === engineFilter
		)
	);
	const missingInputs = $derived(unconfiguredInputs(rows));
	/** A formula calculation holds an ordered set of formulas, and this is where one is added to
	 *  it: authoring a formula from the definition list makes a standalone definition instead. */
	const formulaCalculations = $derived(
		scripts
			.filter((s) => s.engine === 'formula')
			.map((s) => ({
				...s,
				formulas: formulas.filter((f) => f.tool_script_id === s.id).length,
			}))
	);

	onMount(async () => {
		try {
			const [d, t, s, p, closure] = await Promise.all([
				listAll<DerivedParameter>(api.derivedParameters),
				listTools().catch(() => [] as ToolDescriptor[]),
				listToolScripts().catch(() => [] as ToolScriptSummary[]),
				listAll<Parameter>(api.parameters),
				getCalculationClosure({ include_coverage: true }).catch(() => ({
					calculations: [],
					coverage: [],
				})),
			]);
			formulas = d;
			tools = t;
			scripts = s;
			parameters = p;
			coverage = closure.coverage ?? [];
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Failed to load calculations.';
		} finally {
			loading = false;
		}
	});

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
				not a separate surface. A formula calculation's formulas are authored from here; an R
				script's versions from the tool pages.
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
		{#if formulaCalculations.length > 0}
			<div class="rounded-md border border-brand-divider bg-brand-surface px-4 py-3 text-sm">
				<p class="font-semibold">Formula calculations</p>
				<p class="text-brand-muted text-xs mt-0.5">
					Each holds an ordered set of formulas over its group's members and records one run.
				</p>
				<ul class="mt-2 space-y-1">
					{#each formulaCalculations as calculation}
						<li class="flex items-center justify-between gap-3">
							<span>
								{calculation.label || calculation.name}
								<span class="text-brand-muted text-xs">
									({calculation.formulas} formula{calculation.formulas === 1 ? '' : 's'})
								</span>
							</span>
							<a
								href="{base}/derived/new?calculation={calculation.id}"
								class="text-brand-primary no-underline hover:underline text-xs"
							>Add formula</a>
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
								{#if row.enabled === false}
									<Badge variant="muted">off</Badge>
								{:else if row.enabled === true}
									<Badge variant="ok">on</Badge>
								{:else}
									<span class="text-xs text-brand-muted">always</span>
								{/if}
							</td>
						</tr>
					{:else}
						<tr>
							<td colspan="8" class="px-3 py-6 text-center text-sm text-brand-muted">
								No calculations defined.
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
