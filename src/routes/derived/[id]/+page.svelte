<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { api, type DerivedParameter, type SiteParameter, type Site, type Parameter } from '$api/crud';
	import { recomputeDerived } from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';

	let derived = $state<DerivedParameter | null>(null);
	let assignedSites = $state<SiteParameter[]>([]);
	let sites = $state<Site[]>([]);
	let params = $state<Parameter[]>([]);
	let loading = $state(true);

	const derivedId = page.params.id!;

	onMount(async () => {
		try {
			const [d, sp, s, p] = await Promise.all([
				api.derivedParameters.get(derivedId),
				api.siteParameters.list({ perPage: 200, filter: { derived_definition_id: derivedId } }),
				api.sites.list({ perPage: 200 }),
				api.parameters.list({ perPage: 200 }),
			]);
			derived = d;
			assignedSites = sp.data;
			sites = s.data;
			params = p.data;
		} finally { loading = false; }
	});

	function siteName(siteId: string): string { return sites.find((s) => s.id === siteId)?.name ?? siteId; }
	function paramName(paramId: string): string { return params.find((p) => p.id === paramId)?.display_name ?? paramId; }

	async function handleRecompute() {
		try { await recomputeDerived(derivedId); toastStore.success('Recomputation triggered'); }
		catch { toastStore.error('Recomputation failed'); }
	}
</script>

<svelte:head><title>{derived?.name ?? 'Derived'} | River Data</title></svelte:head>

{#if loading}
	<p class="text-brand-muted">Loading...</p>
{:else if derived}
	<div class="space-y-6">
		<div>
			<a href="{base}/derived" class="text-sm text-brand-muted hover:text-brand-primary no-underline">&larr; Derived Parameters</a>
			<div class="flex items-center gap-3 mt-1">
				<h2 class="text-xl font-semibold">{derived.name}</h2>
				<ConfirmPopover message="Recompute all readings?" confirmLabel="Recompute" confirmVariant="primary" onconfirm={handleRecompute}>
					<button class="px-3 py-1 text-sm bg-brand-primary text-white rounded-md cursor-pointer border-none">Recompute</button>
				</ConfirmPopover>
			</div>
		</div>

		<div class="rounded-md border border-brand-divider bg-brand-surface p-4 space-y-3 max-w-xl">
			<div><span class="text-sm text-brand-muted block">Formula</span><pre class="text-sm font-mono bg-brand-bg p-2 rounded mt-1">{derived.formula}</pre></div>
			{#if derived.description}
				<div><span class="text-sm text-brand-muted block">Description</span><p class="text-sm">{derived.description}</p></div>
			{/if}
		</div>

		<div>
			<h3 class="text-base font-semibold mb-2">Assigned Sites ({assignedSites.length})</h3>
			{#if assignedSites.length === 0}
				<p class="text-sm text-brand-muted">Not assigned to any sites yet.</p>
			{:else}
				<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
					<table class="w-full text-sm">
						<thead><tr class="bg-brand-bg border-b border-brand-divider">
							<th class="text-left px-4 py-2 font-semibold">Site</th>
							<th class="text-left px-4 py-2 font-semibold">Parameter</th>
							<th class="text-left px-4 py-2 font-semibold">Units</th>
						</tr></thead>
						<tbody>
							{#each assignedSites as sp}
								<tr class="border-b border-brand-divider last:border-b-0">
									<td class="px-4 py-2"><a href="{base}/sites/{sp.site_id}" class="text-brand-primary no-underline hover:underline">{siteName(sp.site_id)}</a></td>
									<td class="px-4 py-2">{paramName(sp.parameter_id)}</td>
									<td class="px-4 py-2 text-brand-muted">{sp.display_units ?? '—'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	</div>
{/if}
