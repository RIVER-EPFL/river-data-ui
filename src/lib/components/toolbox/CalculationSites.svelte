<script lang="ts">
	import { base } from '$app/paths';
	import { getCalculationSites, listTools, type CalculationSites } from '$api/service';
	import ApplyCalculationAtSite from '$components/toolbox/ApplyCalculationAtSite.svelte';

	// Where the calculation is applied, as the Toolbox and the chain read it, and the site selection
	// that applies it at another (Q274).
	let { id, name }: { id: string; name: string } = $props();

	let sites = $state<CalculationSites['sites'] | null>(null);
	let enabled = $state(true);

	$effect(() => {
		void load(name);
	});

	async function load(calculation: string) {
		sites = null;
		try {
			const [tools, applied] = await Promise.all([listTools(), getCalculationSites()]);
			enabled = tools.some((t) => t.name === calculation);
			sites = applied.find((c) => c.calculation === calculation)?.sites ?? [];
		} catch {
			sites = [];
		}
	}
</script>

<div class="text-xs text-brand-muted" data-testid="calculation-sites">
	<p>
		{#if sites === null}
			Reading where this is applied…
		{:else if !enabled}
			Decommissioned or without an active version, so the chain fires it at no site.
		{:else if sites.length === 0}
			Applied at no site yet.
		{:else}
			Applied at
			{#each sites as site, i (site.id)}
				{#if i > 0}<span> · </span>{/if}
				<a class="text-brand-primary hover:underline" href="{base}/sites/{site.id}?tab=parameters">{site.name}</a>
			{/each}.
		{/if}
	</p>
	{#if enabled}
		<details class="mt-1">
			<summary class="cursor-pointer text-brand-primary">Apply at a site</summary>
			<div class="mt-2 max-w-2xl text-brand-text">
				<ApplyCalculationAtSite calculationId={id} onapplied={() => load(name)} />
			</div>
		</details>
	{/if}
</div>
