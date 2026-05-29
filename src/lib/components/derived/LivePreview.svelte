<script lang="ts">
	import uPlot from 'uplot';
	import UPlotChart from '$lib/components/charts/UPlotChart.svelte';
	import { previewDerived, type PreviewDerivedResponse } from '$api/service';
	import { tokens } from '$lib/charts/tokens';

	let {
		formula,
		sites,
		variableNames,
	}: {
		formula: string;
		sites: Array<{ id: string; name: string; availableParamNames?: string[] }>;
		variableNames: string[];
	} = $props();

	let selectedSiteId = $state<string>('');
	let range = $state<'24h' | '7d' | '30d'>('24h');
	let preview = $state<PreviewDerivedResponse | null>(null);
	let previewError = $state<string | null>(null);
	let loading = $state(false);
	let fetchToken = 0;

	const eligibleSites = $derived(
		sites.filter((s) => {
			if (!s.availableParamNames) return true;
			return variableNames.every((v) => s.availableParamNames!.includes(v));
		})
	);

	$effect(() => {
		if (!selectedSiteId && eligibleSites.length > 0) {
			selectedSiteId = eligibleSites[0].id;
		}
	});

	$effect(() => {
		if (!formula || !selectedSiteId) return;
		const myToken = ++fetchToken;
		const handle = setTimeout(() => {
			void runPreview(myToken);
		}, 400);
		return () => clearTimeout(handle);
	});

	async function runPreview(myToken: number) {
		const end = new Date();
		const start = new Date(end);
		if (range === '24h') start.setUTCDate(end.getUTCDate() - 1);
		else if (range === '7d') start.setUTCDate(end.getUTCDate() - 7);
		else start.setUTCDate(end.getUTCDate() - 30);

		loading = true;
		previewError = null;
		try {
			const result = await previewDerived({
				formula,
				site_id: selectedSiteId,
				start: start.toISOString(),
				end: end.toISOString(),
			});
			if (myToken !== fetchToken) return;
			preview = result;
		} catch (e) {
			if (myToken !== fetchToken) return;
			preview = null;
			previewError = e instanceof Error ? e.message : 'preview failed';
		} finally {
			if (myToken === fetchToken) loading = false;
		}
	}

	const chartData = $derived.by((): uPlot.AlignedData => {
		if (!preview || !preview.times.length) return [new Float64Array()] as unknown as uPlot.AlignedData;
		const ts = preview.times.map((s) => new Date(s).getTime() / 1000);
		const series: uPlot.AlignedData = [ts];
		for (const sp of preview.source_parameters) {
			series.push(sp.values.map((v) => (v == null ? null : v)) as (number | null)[]);
		}
		series.push(preview.derived.values.map((v) => (v == null ? null : v)) as (number | null)[]);
		return series;
	});

	const chartOptions = $derived.by((): uPlot.Options => {
		const series: uPlot.Series[] = [{}];
		if (preview) {
			preview.source_parameters.forEach((sp, i) => {
				series.push({
					label: sp.name,
					stroke: tokens.dataViz[i % tokens.dataViz.length],
					width: 1.5,
					points: { show: false },
				});
			});
			series.push({
				label: preview.derived.name || 'derived',
				stroke: tokens.brand.primary,
				width: 2.5,
				points: { show: false },
			});
		}
		return {
			width: 600,
			height: 320,
			cursor: { drag: { x: true, y: false } },
			scales: { x: { time: true } },
			series,
			legend: { show: true },
		};
	});

	const errorCount = $derived(preview?.derived.errors?.filter((e) => e != null).length ?? 0);
</script>

<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
	<div class="flex items-center justify-between gap-3 px-3 py-2 border-b border-brand-divider bg-brand-bg flex-wrap">
		<span class="text-xs font-semibold text-brand-muted uppercase tracking-wider">Live preview</span>

		<label class="text-xs flex items-center gap-1.5">
			<span class="text-brand-muted">Site</span>
			<select bind:value={selectedSiteId} class="px-2 py-1 text-xs border border-brand-divider rounded bg-brand-surface">
				{#each eligibleSites as s}
					<option value={s.id}>{s.name}</option>
				{/each}
				{#if eligibleSites.length === 0}
					<option value="" disabled>No sites with all required variables</option>
				{/if}
			</select>
		</label>

		<div class="flex gap-0.5">
			{#each ['24h', '7d', '30d'] as r}
				<button
					onclick={() => (range = r as typeof range)}
					class="px-2 py-1 text-xs rounded cursor-pointer border-none {range === r ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted hover:text-brand-text'}"
				>{r}</button>
			{/each}
		</div>
	</div>

	<div class="p-3 min-h-[340px]">
		{#if !formula}
			<p class="text-sm text-brand-muted">Build a formula to see a preview here.</p>
		{:else if !selectedSiteId}
			<p class="text-sm text-brand-muted">No site available with all required variables.</p>
		{:else if loading && !preview}
			<p class="text-sm text-brand-muted">Loading preview...</p>
		{:else if previewError}
			<p class="text-sm text-severity-alarm">Preview error: {previewError}</p>
		{:else if preview}
			{#if chartData[0].length === 0}
				<p class="text-sm text-brand-muted">No data in selected range.</p>
			{:else}
				<UPlotChart options={chartOptions} data={chartData} class="w-full" />
				{#if errorCount > 0}
					<p class="text-xs text-severity-warning mt-2">{errorCount} of {preview.derived.values.length} samples produced errors.</p>
				{/if}
			{/if}
		{/if}
	</div>
</div>
