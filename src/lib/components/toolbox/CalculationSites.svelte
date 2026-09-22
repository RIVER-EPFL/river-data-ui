<script lang="ts">
	import { base } from '$app/paths';
	import { api, type Site, type SiteParameter } from '$api/crud';
	import { listAll } from '$api/paged';
	import { listTools } from '$api/service';
	import { sitesApplied } from '$lib/calculations/apply';

	// Where the calculation is applied, read-only: applying one happens on a site's Parameters tab.
	let { name }: { name: string } = $props();

	let sites = $state<Array<{ id: string; name: string }> | null>(null);
	let enabled = $state(true);

	$effect(() => {
		void load(name);
	});

	async function load(calculation: string) {
		sites = null;
		try {
			const tool = (await listTools()).find((t) => t.name === calculation);
			enabled = tool != null;
			const outputIds = [
				...new Set((tool?.outputs ?? []).flatMap((o) => (o.parameter ? [o.parameter.id] : []))),
			];
			if (outputIds.length === 0) {
				sites = [];
				return;
			}
			const [slots, catalog] = await Promise.all([
				listAll<SiteParameter>(api.siteParameters, { filter: { parameter_id: outputIds } }),
				listAll<Site>(api.sites),
			]);
			sites = sitesApplied(outputIds, slots, catalog);
		} catch {
			sites = [];
		}
	}
</script>

<p class="text-xs text-brand-muted" data-testid="calculation-sites">
	{#if sites === null}
		Reading where this is applied…
	{:else if !enabled}
		Switched off, so the chain fires it at no site.
	{:else if sites.length === 0}
		Applied at no site yet. A calculation is applied from a site's Parameters tab.
	{:else}
		Applied at
		{#each sites as site, i (site.id)}
			{#if i > 0}<span> · </span>{/if}
			<a class="text-brand-primary hover:underline" href="{base}/sites/{site.id}?tab=parameters">{site.name}</a>
		{/each}. Applied from a site's Parameters tab.
	{/if}
</p>
