<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { api, type DerivedParameter, type SiteParameter, type Site, type Parameter } from '$api/crud';
	import { recomputeDerived } from '$api/service';
	import { formatThresholdRange } from '$lib/alarms';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Button from '$components/ui/Button.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import Breadcrumbs from '$components/ui/Breadcrumbs.svelte';
	import MultiSiteParameterPlot from '$components/parameters/MultiSiteParameterPlot.svelte';

	let def = $state<DerivedParameter | null>(null);
	let assignedSiteParams = $state<SiteParameter[]>([]);
	let sites = $state<Site[]>([]);
	let params = $state<Parameter[]>([]);
	let outputParam = $state<Parameter | null>(null);
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
			if (d.output_parameter_id) {
				outputParam = params.find((pp) => pp.id === d.output_parameter_id)
					?? await api.parameters.get(d.output_parameter_id);
			}
		} finally { loading = false; }
	});

	function siteName(siteId: string): string { return sites.find((s) => s.id === siteId)?.name ?? siteId; }
	function paramName(paramId: string): string {
		const p = params.find((p) => p.id === paramId);
		if (!p) return paramId;
		return p.default_units ? `${p.name} (${p.default_units})` : p.name;
	}

	const outputParameterId = $derived(
		def?.output_parameter_id ?? assignedSiteParams[0]?.parameter_id ?? ''
	);

	const plotSiteOptions = $derived(
		assignedSiteParams
			.map((sp) => ({
				siteId: sp.site_id,
				siteName: siteName(sp.site_id),
				siteParameterId: sp.id,
				displayUnits: sp.display_units,
			}))
			.sort((a, b) => a.siteName.localeCompare(b.siteName))
	);

	async function handleRecompute() {
		try { await recomputeDerived(defId); toastStore.success('Recomputation triggered'); }
		catch { toastStore.error('Recomputation failed'); }
	}
</script>

<svelte:head><title>{def?.name ?? 'Derived'} | River Data</title></svelte:head>

{#if loading}
	<p class="text-brand-muted">Loading…</p>
{:else if def}
	<div class="space-y-6">
		<div>
			<Breadcrumbs items={[{ label: 'Parameters (derived)', href: `${base}/parameters?type=derived` }]} />
			<div class="flex items-center gap-3 mt-1">
				<h2 class="text-xl font-semibold">{def.name || def.code}</h2>
				<a href="{base}/derived/{defId}/edit" class="px-3 py-1 text-sm border border-brand-divider bg-brand-surface rounded-md no-underline text-brand-text hover:bg-brand-bg">Edit</a>
				<ConfirmPopover message="Recompute all readings?" confirmLabel="Recompute" confirmVariant="primary" onconfirm={handleRecompute}>
					<Button variant="primary">Recompute</Button>
				</ConfirmPopover>
			</div>
		</div>

		<div class="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
		<div class="md:col-span-2 rounded-md border border-brand-divider bg-brand-surface p-4 space-y-3">
			<div>
				<span class="text-sm text-brand-muted block">Formula</span>
				<pre class="text-sm font-mono bg-brand-bg p-3 rounded mt-1 overflow-x-auto">{def.formula}</pre>
			</div>
			{#if def.units}
				<div><span class="text-sm text-brand-muted block">Units</span><p class="text-sm">{def.units}</p></div>
			{/if}
			{#if outputParam}
				{@const warningRange = formatThresholdRange(outputParam.default_warning_min, outputParam.default_warning_max, def.units)}
				{@const alarmRange = formatThresholdRange(outputParam.default_alarm_min, outputParam.default_alarm_max, def.units)}
				<div class="grid grid-cols-2 gap-3">
					<div>
						<span class="text-sm text-brand-muted block">Default Warning</span>
						{#if warningRange}<p class="text-sm">{warningRange}</p>{:else}<p class="text-sm text-brand-muted">None</p>{/if}
					</div>
					<div>
						<span class="text-sm text-brand-muted block">Default Alarm</span>
						{#if alarmRange}<p class="text-sm">{alarmRange}</p>{:else}<p class="text-sm text-brand-muted">None</p>{/if}
					</div>
				</div>
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

		<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
			<div class="px-4 py-2.5 bg-brand-bg border-b border-brand-divider">
				<span class="text-sm font-semibold">Assigned Sites ({assignedSiteParams.length})</span>
			</div>
			{#if assignedSiteParams.length === 0}
				<p class="text-sm text-brand-muted px-4 py-3">Not assigned to any sites yet. Assign from a site's Parameters tab.</p>
			{:else}
				<ul class="divide-y divide-brand-divider max-h-56 overflow-y-auto">
					{#each plotSiteOptions as opt}
						<li class="px-4 py-2 flex items-center justify-between text-sm">
							<a href="{base}/sites/{opt.siteId}" class="text-brand-primary no-underline hover:underline">{opt.siteName}</a>
							<span class="text-xs text-brand-muted">{opt.displayUnits ?? def.units}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
		</div>

		<!-- Computed readings across assigned sites -->
		<MultiSiteParameterPlot
			parameterId={outputParameterId}
			parameterName={def.name || def.code}
			units={def.units}
			siteOptions={plotSiteOptions}
			title="Computed Readings"
			emptyMessage="Not assigned to any sites yet. Assign from a site's Parameters tab."
		/>
	</div>
{/if}
