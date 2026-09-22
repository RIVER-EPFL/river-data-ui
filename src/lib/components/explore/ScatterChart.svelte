<script lang="ts">
	import type { Site, Parameter, SiteParameter } from '$api/crud';
	import { GET } from '$api/client';
	import type { ReadingsResponse } from '$lib/api/types';
	import type { ScatterSpec } from '$lib/explore/chartSpecs';
	import Button from '$components/ui/Button.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import ScatterPlot from '$components/charts/ScatterPlot.svelte';
	import TimeRangeControls from '$components/charts/TimeRangeControls.svelte';
	import SiteSelect from '$components/SiteSelect.svelte';
	import ChartCard from './ChartCard.svelte';

	let {
		sites,
		params,
		siteParams,
		spec = $bindable(),
		index,
		removable,
		onremove,
	}: {
		sites: Site[];
		params: Parameter[];
		siteParams: SiteParameter[];
		spec: ScatterSpec;
		index: number;
		removable: boolean;
		onremove: () => void;
	} = $props();

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
		if (!spec.siteId) return [];
		const spIds = new Set(siteParams.filter((sp) => sp.site_id === spec.siteId).map((sp) => sp.parameter_id));
		return params.filter((p) => spIds.has(p.id));
	});

	// Drop selections that are no longer valid for the chosen site
	$effect(() => {
		const ids = new Set(availableParams().map((p) => p.id));
		if (spec.xParamId && !ids.has(spec.xParamId)) spec.xParamId = '';
		if (spec.yParamId && !ids.has(spec.yParamId)) spec.yParamId = '';
	});

	const ready = $derived(!!spec.siteId && !!spec.xParamId && !!spec.yParamId && !!spec.start && !!spec.end);
	const title = $derived.by(() => {
		const site = sites.find((s) => s.id === spec.siteId)?.name;
		const x = params.find((p) => p.id === spec.xParamId)?.name;
		const y = params.find((p) => p.id === spec.yParamId)?.name;
		return site && x && y ? `${site}: ${x} vs ${y}` : `Chart ${index + 1}`;
	});

	async function loadScatterData() {
		if (!ready) return;
		const { siteId, xParamId, yParamId, start, end } = spec;
		scatterLoading = true;
		scatterError = null;
		scatterData = null;
		try {
			const result = await GET<ReadingsResponse>(`/api/sites/${siteId}/readings`, {
				start: new Date(start).toISOString(),
				end: new Date(end).toISOString(),
				parameter_ids: `${xParamId},${yParamId}`,
				page_size: 10000,
			});

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
				xUnits: xParam?.default_units ?? '',
				yUnits: yParam?.default_units ?? '',
			};
		} catch {
			scatterError = 'Failed to load scatter data.';
		} finally {
			scatterLoading = false;
		}
	}

	// Debounced auto-refresh: re-run the load whenever any input changes
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		void spec.siteId;
		void spec.xParamId;
		void spec.yParamId;
		void spec.start;
		void spec.end;
		if (!ready) return;
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			void loadScatterData();
		}, 100);
		return () => clearTimeout(debounceTimer);
	});

	const id = $derived(`scatter-${index}`);
</script>

<ChartCard {title} {removable} {onremove}>
	{#snippet controls()}
		<div>
			<label for="{id}-site" class="text-sm font-medium block mb-1">Site</label>
			<SiteSelect
				id="{id}-site"
				bind:value={spec.siteId}
				{sites}
				class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
			/>
		</div>
		<div>
			<label for="{id}-x" class="text-sm font-medium block mb-1">X Axis</label>
			<select id="{id}-x" bind:value={spec.xParamId} disabled={!spec.siteId} class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm disabled:opacity-50">
				<option value="">-- Select --</option>
				{#each availableParams() as p}
					<option value={p.id} disabled={p.id === spec.yParamId}>{p.name} ({p.default_units})</option>
				{/each}
			</select>
		</div>
		<div>
			<label for="{id}-y" class="text-sm font-medium block mb-1">Y Axis</label>
			<select id="{id}-y" bind:value={spec.yParamId} disabled={!spec.siteId} class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm disabled:opacity-50">
				<option value="">-- Select --</option>
				{#each availableParams() as p}
					<option value={p.id} disabled={p.id === spec.xParamId}>{p.name} ({p.default_units})</option>
				{/each}
			</select>
		</div>
		<TimeRangeControls siteIds={spec.siteId ? [spec.siteId] : []} bind:start={spec.start} bind:end={spec.end} />
		<Button variant="primary" onclick={loadScatterData} disabled={!ready || scatterLoading} class="w-full">
			{scatterLoading ? 'Loading…' : 'Plot'}
		</Button>
	{/snippet}
	{#snippet chart()}
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
	{/snippet}
</ChartCard>
