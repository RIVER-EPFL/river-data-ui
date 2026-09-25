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

{#if enabled}
	<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-brand-muted" data-testid="calculation-sites">
		<p>
			{#if sites === null}
				Reading where this is applied…
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
		<details class="relative">
			<summary class="cursor-pointer text-brand-primary">Apply at a site</summary>
			<div class="absolute right-0 top-full z-30 mt-1 w-[min(42rem,90vw)] rounded-md border border-brand-divider bg-brand-surface p-3 text-brand-text shadow-lg">
				<ApplyCalculationAtSite calculationId={id} onapplied={() => load(name)} />
			</div>
		</details>
	</div>
{/if}
