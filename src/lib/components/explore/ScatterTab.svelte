<script lang="ts">
	import { onMount } from 'svelte';
	import type { Site, Parameter, SiteParameter } from '$api/crud';
	import { GET } from '$api/client';
	import type { ReadingsResponse } from '$lib/api/types';
	import Button from '$components/ui/Button.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import ScatterPlot from '$components/charts/ScatterPlot.svelte';
	import TimeRangeControls from '$components/charts/TimeRangeControls.svelte';

	let {
		sites,
		params,
		siteParams,
		siteId = $bindable(),
		xParamId = $bindable(),
		yParamId = $bindable(),
		start = $bindable(),
		end = $bindable(),
		defaultSiteId = '',
	}: {
		sites: Site[];
		params: Parameter[];
		siteParams: SiteParameter[];
		siteId: string;
		xParamId: string;
		yParamId: string;
		start: number;
		end: number;
		defaultSiteId?: string;
	} = $props();

	// First visit: adopt the site already picked on the Time Series tab.
	onMount(() => {
		if (!siteId && defaultSiteId) siteId = defaultSiteId;
	});

	interface ScatterData {
		xValues: (number | null)[];
		yValues: (number | null)[];
		times: number[];
		xLabel: string;
		yLabel: string;
		xUnits: string;
		yUnits: string;
	}
	let scatterData = $state<ScatterData | null>(null);
	let scatterLoading = $state(false);
	let scatterError = $state<string | null>(null);

	const availableParams = $derived(() => {
		if (!siteId) return [];
		const spIds = new Set(siteParams.filter((sp) => sp.site_id === siteId).map((sp) => sp.parameter_id));
		return params.filter((p) => spIds.has(p.id));
	});

	// Drop selections that are no longer valid for the chosen site
	$effect(() => {
		const ids = new Set(availableParams().map((p) => p.id));
		if (xParamId && !ids.has(xParamId)) xParamId = '';
		if (yParamId && !ids.has(yParamId)) yParamId = '';
	});

	async function loadScatterData() {
		if (!siteId || !xParamId || !yParamId || !start || !end) return;
		scatterLoading = true;
		scatterError = null;
		scatterData = null;
		try {
			const result = await GET<ReadingsResponse>(
				`/api/sites/${siteId}/readings`,
				{
					start: new Date(start).toISOString(),
					end: new Date(end).toISOString(),
					parameter_ids: `${xParamId},${yParamId}`,
					page_size: 10000,
				},
			);

			const xParam = params.find((p) => p.id === xParamId);
			const yParam = params.find((p) => p.id === yParamId);
			const xSp = siteParams.find((sp) => sp.site_id === siteId && sp.parameter_id === xParamId);
			const ySp = siteParams.find((sp) => sp.site_id === siteId && sp.parameter_id === yParamId);

			const xSeries = result.parameters?.find((p) => p.id === xSp?.id || p.parameter_id === xParamId);
			const ySeries = result.parameters?.find((p) => p.id === ySp?.id || p.parameter_id === yParamId);

			if (!result.times?.length || !xSeries || !ySeries) {
				scatterError = 'No data available for the selected parameters and time range.';
				return;
			}

			scatterData = {
				xValues: xSeries.values,
				yValues: ySeries.values,
				times: result.times.map((t) => new Date(t).getTime() / 1000),
				xLabel: xParam?.name ?? 'X',
				yLabel: yParam?.name ?? 'Y',
				xUnits: xSp?.display_units ?? xParam?.default_units ?? '',
				yUnits: ySp?.display_units ?? yParam?.default_units ?? '',
			};
		} catch {
			scatterError = 'Failed to load scatter data.';
		} finally { scatterLoading = false; }
	}

	// Debounced auto-refresh: re-run the load whenever any input changes
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		// track dependencies
		void siteId;
		void xParamId;
		void yParamId;
		void start;
		void end;
		if (!siteId || !xParamId || !yParamId || !start || !end) return;
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			void loadScatterData();
		}, 100);
		return () => clearTimeout(debounceTimer);
	});
</script>

<div class="grid grid-cols-1 md:grid-cols-4 gap-4">
	<!-- Controls -->
	<div class="space-y-3">
		<div>
			<label for="scatter-site" class="text-sm font-medium block mb-1">Site</label>
			<select id="scatter-site" bind:value={siteId} class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
				<option value="">-- Select site --</option>
				{#each sites as site}
					<option value={site.id}>{site.name}</option>
				{/each}
			</select>
		</div>
		<div>
			<label for="scatter-x" class="text-sm font-medium block mb-1">X Axis</label>
			<select id="scatter-x" bind:value={xParamId} disabled={!siteId} class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm disabled:opacity-50">
				<option value="">-- Select --</option>
				{#each availableParams() as p}
					<option value={p.id} disabled={p.id === yParamId}>{p.name} ({p.default_units})</option>
				{/each}
			</select>
		</div>
		<div>
			<label for="scatter-y" class="text-sm font-medium block mb-1">Y Axis</label>
			<select id="scatter-y" bind:value={yParamId} disabled={!siteId} class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm disabled:opacity-50">
				<option value="">-- Select --</option>
				{#each availableParams() as p}
					<option value={p.id} disabled={p.id === xParamId}>{p.name} ({p.default_units})</option>
				{/each}
			</select>
		</div>
		<TimeRangeControls siteIds={siteId ? [siteId] : []} bind:start bind:end />
		<Button variant="primary" onclick={loadScatterData} disabled={!siteId || !xParamId || !yParamId || scatterLoading}
			class="w-full">
			{scatterLoading ? 'Loading…' : 'Plot'}
		</Button>
	</div>

	<!-- Chart area -->
	<div class="md:col-span-3 rounded-md border border-brand-divider bg-brand-surface p-4 min-h-[400px]">
		{#if scatterLoading}
			<div class="flex items-center justify-center h-full text-brand-muted text-sm">Loading scatter data…</div>
		{:else if scatterError}
			<ErrorNotice message={scatterError} />
		{:else if scatterData}
			<ScatterPlot
				xData={scatterData.xValues}
				yData={scatterData.yValues}
				xLabel={scatterData.xLabel}
				yLabel={scatterData.yLabel}
				xUnits={scatterData.xUnits}
				yUnits={scatterData.yUnits}
				times={scatterData.times}
			/>
		{:else}
			<div class="flex items-center justify-center h-full text-brand-muted text-sm">
				Select a site and two parameters
			</div>
		{/if}
	</div>
</div>
