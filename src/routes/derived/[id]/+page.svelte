<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { api, type DerivedParameter, type SiteParameter, type Site, type Parameter } from '$api/crud';
	import { recomputeDerived } from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import DerivedPreview from '$lib/components/derived/DerivedPreview.svelte';

	let def = $state<DerivedParameter | null>(null);
	let assignedSiteParams = $state<SiteParameter[]>([]);
	let sites = $state<Site[]>([]);
	let params = $state<Parameter[]>([]);
	let loading = $state(true);

	const defId = page.params.id!;

	onMount(async () => {
		try {
			const [d, sp, s, p] = await Promise.all([
				api.derivedParameters.get(defId),
				api.siteParameters.list({ perPage: 200, filter: { derived_definition_id: defId } }),
				api.sites.list({ perPage: 200 }),
				api.parameters.list({ perPage: 200 }),
			]);
			def = d;
			assignedSiteParams = sp.data;
			sites = s.data;
			params = p.data;
		} finally { loading = false; }
	});

	function siteName(siteId: string): string { return sites.find((s) => s.id === siteId)?.name ?? siteId; }
	function paramName(paramId: string): string { return params.find((p) => p.id === paramId)?.display_name ?? paramId; }

	const assignedSites = $derived(
		assignedSiteParams
			.map((sp) => sites.find((s) => s.id === sp.site_id))
			.filter((s): s is Site => s != null)
			.map((s) => ({ id: s.id, name: s.name }))
	);

	const previewSites = $derived(
		assignedSites.length > 0
			? assignedSites
			: sites.map((s) => ({ id: s.id, name: s.name }))
	);

	async function handleRecompute() {
		try { await recomputeDerived(defId); toastStore.success('Recomputation triggered'); }
		catch { toastStore.error('Recomputation failed'); }
	}
</script>

<svelte:head><title>{def?.name ?? 'Derived'} | River Data</title></svelte:head>

{#if loading}
	<p class="text-brand-muted">Loading...</p>
{:else if def}
	<div class="space-y-6">
		<div>
			<a href="{base}/derived" class="text-sm text-brand-muted hover:text-brand-primary no-underline">&larr; Derived Parameters</a>
			<div class="flex items-center gap-3 mt-1">
				<h2 class="text-xl font-semibold">{def.display_name || def.name}</h2>
				<ConfirmPopover message="Recompute all readings?" confirmLabel="Recompute" confirmVariant="primary" onconfirm={handleRecompute}>
					<button class="px-3 py-1 text-sm bg-brand-primary text-white rounded-md cursor-pointer border-none">Recompute</button>
				</ConfirmPopover>
			</div>
		</div>

		<div class="rounded-md border border-brand-divider bg-brand-surface p-4 space-y-3 max-w-2xl">
			<div>
				<span class="text-sm text-brand-muted block">Formula</span>
				<pre class="text-sm font-mono bg-brand-bg p-3 rounded mt-1 overflow-x-auto">{def.formula}</pre>
			</div>
			{#if def.units}
				<div><span class="text-sm text-brand-muted block">Units</span><p class="text-sm">{def.units}</p></div>
			{/if}
			{#if def.description}
				<div><span class="text-sm text-brand-muted block">Description</span><p class="text-sm">{def.description}</p></div>
			{/if}
			{#if def.sources && def.sources.length > 0}
				<div>
					<span class="text-sm text-brand-muted block mb-1">Source Variables</span>
					<div class="flex flex-wrap gap-2">
						{#each def.sources as src}
							<span class="px-2 py-1 text-xs bg-brand-bg rounded border border-brand-divider">
								<span class="font-mono font-medium">{src.variable_name}</span>
								<span class="text-brand-muted ml-1">= {paramName(src.parameter_id)}</span>
							</span>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		<!-- Assigned Sites -->
		<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
			<div class="px-4 py-3 bg-brand-bg border-b border-brand-divider">
				<span class="text-sm font-semibold">Assigned Sites ({assignedSiteParams.length})</span>
			</div>
			{#if assignedSiteParams.length === 0}
				<p class="text-sm text-brand-muted px-4 py-4">Not assigned to any sites yet. Assign from a site's Parameters tab.</p>
			{:else}
				<table class="w-full text-sm">
					<thead><tr class="bg-brand-bg border-b border-brand-divider">
						<th class="text-left px-4 py-2 font-semibold">Site</th>
						<th class="text-left px-4 py-2 font-semibold">Parameter</th>
						<th class="text-left px-4 py-2 font-semibold">Units</th>
					</tr></thead>
					<tbody>
						{#each assignedSiteParams as sp}
							<tr class="border-b border-brand-divider last:border-b-0">
								<td class="px-4 py-2"><a href="{base}/sites/{sp.site_id}" class="text-brand-primary no-underline hover:underline">{siteName(sp.site_id)}</a></td>
								<td class="px-4 py-2">{paramName(sp.parameter_id)}</td>
								<td class="px-4 py-2 text-brand-muted">{sp.display_units ?? '---'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>

		<!-- Preview -->
		{#if def.formula}
			<DerivedPreview formula={def.formula} sites={previewSites} />
		{/if}
	</div>
{/if}
