<script lang="ts">
	import { onMount } from 'svelte';
	import { api, type Site, type Parameter, type SiteParameter } from '$api/crud';
	import type { Frequency } from '$lib/charts/multiSiteSeries';
	import { createUrlTab } from '$lib/urlTab.svelte';
	import Tabs from '$components/ui/Tabs.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import TimeSeriesTab from '$components/explore/TimeSeriesTab.svelte';
	import ScatterTab from '$components/explore/ScatterTab.svelte';
	import DayOfYearTab from '$components/explore/DayOfYearTab.svelte';

	const TAB_LABELS = ['Time Series', 'Scatter', 'Day of Year'];
	const tab = createUrlTab({ keys: ['timeseries', 'scatter', 'doy'] });

	// Metadata loaded once for all tabs (supersets; per-tab views derived below).
	let sites = $state<Site[]>([]);
	let allParams = $state<Parameter[]>([]);
	let allSiteParams = $state<SiteParameter[]>([]);
	let loading = $state(true);
	let pageError = $state<string | null>(null);

	onMount(async () => {
		try {
			const [s, p, sp] = await Promise.all([
				api.sites.list({ perPage: 200 }),
				api.parameters.list({ perPage: 500 }),
				api.siteParameters.list({ perPage: 1000 }),
			]);
			sites = s.data;
			allParams = p.data;
			allSiteParams = sp.data;
		} catch (e) {
			pageError = e instanceof Error ? e.message : 'Failed to load metadata';
		} finally {
			loading = false;
		}
	});

	// Time Series / Scatter offer measurement parameters; Day of Year offers parameters
	// actually measured by an active site-parameter, name-sorted.
	const measurementParams = $derived(allParams.filter((p) => p.category === 'measurement'));
	const activeSiteParams = $derived(allSiteParams.filter((sp) => sp.is_active));
	const doyParams = $derived.by(() => {
		const measured = new Set(activeSiteParams.map((sp) => sp.parameter_id));
		return allParams.filter((p) => measured.has(p.id)).sort((a, b) => a.name.localeCompare(b.name));
	});

	// Selection state lives here so it survives tab switches.
	// Shared across tabs:
	let selectedSiteIds = $state<string[]>([]);
	let selectedParamId = $state('');
	let start = $state(0);
	let end = $state(0);
	// Time Series:
	let resolution = $state<'raw' | 'hourly' | 'daily'>('hourly');
	let tsFrequency = $state<Frequency>('high');
	let statsOpen = $state(true);
	// Scatter:
	let scatterSiteId = $state('');
	let xParamId = $state('');
	let yParamId = $state('');
	// Day of Year:
	const currentYear = new Date().getUTCFullYear();
	let selectedYears = $state<number[]>([currentYear, currentYear - 1, currentYear - 2]);
	let doyFrequency = $state<Frequency>('high');
	let doyLastParamForSites = $state('');
</script>

<svelte:head><title>Explore | RIVER Data</title></svelte:head>

<div class="space-y-4">
	<div>
		<h2 class="text-xl font-semibold">Explore</h2>
		{#if tab.key === 'doy'}
			<p class="text-sm text-brand-muted mt-1">
				Seasonal overlay: each year of a parameter is folded onto a shared annual axis so recurring
				patterns line up across years.
			</p>
		{/if}
	</div>

	<Tabs tabs={TAB_LABELS} bind:active={tab.index} />

	{#if loading}
		<p class="text-brand-muted">Loading…</p>
	{:else if pageError}
		<ErrorNotice message={pageError} />
	{:else if tab.key === 'timeseries'}
		<TimeSeriesTab
			{sites}
			params={measurementParams}
			siteParams={allSiteParams}
			bind:selectedSiteIds
			bind:selectedParamId
			bind:resolution
			bind:frequency={tsFrequency}
			bind:start
			bind:end
			bind:statsOpen
		/>
	{:else if tab.key === 'scatter'}
		<ScatterTab
			{sites}
			params={measurementParams}
			siteParams={allSiteParams}
			bind:siteId={scatterSiteId}
			bind:xParamId
			bind:yParamId
			bind:start
			bind:end
			defaultSiteId={selectedSiteIds[0] ?? ''}
		/>
	{:else if tab.key === 'doy'}
		<DayOfYearTab
			{sites}
			parameters={doyParams}
			siteParameters={activeSiteParams}
			bind:selectedParameterId={selectedParamId}
			bind:selectedSiteIds
			bind:selectedYears
			bind:frequency={doyFrequency}
			bind:lastParamForSites={doyLastParamForSites}
		/>
	{/if}
</div>
