<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { listToolScripts, type ToolScriptSummary } from '$api/service';
	import { AUTHORING_REFUSED, loadCatalog } from '$lib/toolbox/authoring';
	import { findCalculation } from '$lib/toolbox/route';
	import Breadcrumbs from '$components/ui/Breadcrumbs.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import CalculationSites from '$components/toolbox/CalculationSites.svelte';
	import FormulaCalculation from '$components/toolbox/FormulaCalculation.svelte';
	import ScriptEditor from '$components/toolbox/ScriptEditor.svelte';

	// A calculation's page: its formulas for the formula engine, its script for R.
	let calculation = $state<ToolScriptSummary | null>(null);
	let loading = $state(true);
	let error = $state('');

	// Derived, so a query change the page makes to itself does not reload and remount it.
	const key = $derived(page.params.id ?? '');

	$effect(() => {
		const wanted = key;
		loading = true;
		void loadCatalog(listToolScripts).then((load) => {
			if (load.status === 'refused') error = AUTHORING_REFUSED;
			else if (load.status === 'failed') error = load.message;
			else {
				calculation = findCalculation(load.items, wanted);
				error = calculation ? '' : `No calculation named ${wanted}.`;
			}
			loading = false;
		});
	});
</script>

<svelte:head>
	{#if calculation && calculation.engine !== 'formula'}
		<title>{calculation.label || calculation.name} | RIVER Data</title>
	{/if}
</svelte:head>

{#if error}
	<ErrorNotice message={error} />
{:else if loading || !calculation}
	<p class="text-sm text-brand-muted">Loading…</p>
{:else if calculation.engine === 'formula'}
	{#key calculation.id}
		<FormulaCalculation calculationId={calculation.id} />
	{/key}
{:else}
	<div class="space-y-3">
		<Breadcrumbs items={[{ label: 'Toolbox', href: `${base}/toolbox` }, { label: calculation.label || calculation.name }]} />
		{#key calculation.id}
			<ScriptEditor scriptId={calculation.id} />
		{/key}
		<CalculationSites id={calculation.id} name={calculation.name} />
	</div>
{/if}
