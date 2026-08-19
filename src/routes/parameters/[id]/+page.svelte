<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api, type Parameter, type Site, type SiteParameter } from '$api/crud';
	import { formatThresholdRange } from '$lib/alarms';
	import Badge from '$components/ui/Badge.svelte';
	import Breadcrumbs from '$components/ui/Breadcrumbs.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import MultiSiteParameterPlot from '$components/parameters/MultiSiteParameterPlot.svelte';
	import ConfirmParameterButton from '$components/parameters/ConfirmParameterButton.svelte';

	let param = $state<Parameter | null>(null);
	let siteParams = $state<SiteParameter[]>([]);
	let sites = $state<Site[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	const paramId = page.params.id!;

	onMount(async () => {
		try {
			const [p, sp, s, defs] = await Promise.all([
				api.parameters.get(paramId),
				api.siteParameters.list({ perPage: 500, filter: { parameter_id: paramId, is_active: true } }),
				api.sites.list({ perPage: 200 }),
				api.derivedParameters.list({ perPage: 500 }),
			]);
			// Output parameters of derived definitions are managed via the derived
			// pages (formula builder, preview, recompute), send the user there.
			const derivedDef = defs.data.find((d) => d.output_parameter_id === paramId);
			if (derivedDef) {
				goto(`${base}/derived/${derivedDef.id}`, { replaceState: true });
				return;
			}
			param = p;
			siteParams = sp.data;
			sites = s.data;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load parameter';
		} finally { loading = false; }
	});

	function siteName(siteId: string): string { return sites.find((s) => s.id === siteId)?.name ?? siteId; }

	const siteOptions = $derived(
		siteParams
			.map((sp) => ({
				siteId: sp.site_id,
				siteName: siteName(sp.site_id),
				siteParameterId: sp.id,
				displayUnits: sp.display_units,
			}))
			.sort((a, b) => a.siteName.localeCompare(b.siteName))
	);

	const warningRange = $derived(
		param ? formatThresholdRange(param.default_warning_min, param.default_warning_max, param.default_units) : null
	);
	const alarmRange = $derived(
		param ? formatThresholdRange(param.default_alarm_min, param.default_alarm_max, param.default_units) : null
	);
</script>

<svelte:head><title>{param?.name ?? 'Parameter'} | River Data</title></svelte:head>

{#if loading}
	<p class="text-brand-muted">Loading…</p>
{:else if error}
	<ErrorNotice message={error} />
{:else if param}
	<div class="space-y-6">
		<div>
			<Breadcrumbs items={[{ label: 'Parameters', href: `${base}/parameters` }]} />
			<div class="flex items-center gap-3 mt-1">
				<h2 class="text-xl font-semibold">{param.name}</h2>
				<Badge variant={param.category === 'device_health' ? 'accent' : 'default'}>
					{param.category === 'device_health' ? 'Device Health' : 'Measurement'}
				</Badge>
				{#if param.needs_review}
					<Badge variant="warning">Needs review</Badge>
					<ConfirmParameterButton parameter={param} onconfirmed={(p) => (param = p)} />
				{/if}
				<a href="{base}/parameters/{paramId}/edit" class="px-3 py-1 text-sm border border-brand-divider bg-brand-surface rounded-md no-underline text-brand-text hover:bg-brand-bg">Edit</a>
			</div>
		</div>

		<div class="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
		<div class="md:col-span-2 rounded-md border border-brand-divider bg-brand-surface p-4 space-y-3">
			<div class="grid grid-cols-2 gap-3">
				<div>
					<span class="text-sm text-brand-muted block">Code</span>
					<p class="text-sm font-mono">{param.code}</p>
				</div>
				<div>
					<span class="text-sm text-brand-muted block">Default Units</span>
					<p class="text-sm">{param.default_units}</p>
				</div>
				<div>
					<span class="text-sm text-brand-muted block">Default Warning</span>
					{#if warningRange}<p class="text-sm">{warningRange}</p>{:else}<p class="text-sm text-brand-muted">None</p>{/if}
				</div>
				<div>
					<span class="text-sm text-brand-muted block">Default Alarm</span>
					{#if alarmRange}<p class="text-sm">{alarmRange}</p>{:else}<p class="text-sm text-brand-muted">None</p>{/if}
				</div>
			</div>
			{#if param.aliases && param.aliases.length > 0}
				<div>
					<span class="text-sm text-brand-muted block mb-1">Aliases</span>
					<div class="flex flex-wrap gap-2">
						{#each param.aliases as alias}
							<span class="px-2 py-1 text-xs font-mono bg-brand-bg rounded border border-brand-divider">{alias}</span>
						{/each}
					</div>
				</div>
			{/if}
			{#if param.description}
				<div><span class="text-sm text-brand-muted block">Description</span><p class="text-sm">{param.description}</p></div>
			{/if}
		</div>

		<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
			<div class="px-4 py-2.5 bg-brand-bg border-b border-brand-divider">
				<span class="text-sm font-semibold">Sites ({siteParams.length})</span>
			</div>
			{#if siteOptions.length === 0}
				<p class="text-sm text-brand-muted px-4 py-3">Not measured at any sites yet.</p>
			{:else}
				<ul class="divide-y divide-brand-divider max-h-56 overflow-y-auto">
					{#each siteOptions as opt}
						<li class="px-4 py-2 flex items-center justify-between text-sm">
							<a href="{base}/sites/{opt.siteId}" class="text-brand-primary no-underline hover:underline">{opt.siteName}</a>
							<span class="text-xs text-brand-muted">{opt.displayUnits ?? param.default_units}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
		</div>

		<MultiSiteParameterPlot
			parameterId={paramId}
			parameterName={param.name}
			units={param.default_units}
			{siteOptions}
			emptyMessage="This parameter is not measured at any sites yet."
		/>
	</div>
{/if}
