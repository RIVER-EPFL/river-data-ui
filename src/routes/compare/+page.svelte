<script lang="ts">
	import { onMount } from 'svelte';
	import { api, type Site, type Parameter, type SiteParameter } from '$api/crud';
	import { GET } from '$api/client';

	let sites = $state<Site[]>([]);
	let params = $state<Parameter[]>([]);
	let siteParams = $state<SiteParameter[]>([]);
	let loading = $state(true);
	let mode = $state<'time' | 'scatter'>('time');

	// Selection
	let selectedSiteIds = $state<string[]>([]);
	let selectedParamId = $state('');
	let start = $state('');
	let end = $state('');
	let resolution = $state<'raw' | 'hourly' | 'daily'>('hourly');

	// Data
	let chartData = $state<Array<{ site: string; times: number[]; values: number[] }>>([]);
	let loadingData = $state(false);

	onMount(async () => {
		try {
			const [s, p, sp] = await Promise.all([
				api.sites.list({ perPage: 200 }),
				api.parameters.list({ perPage: 500, filter: { category: 'measurement' } }),
				api.siteParameters.list({ perPage: 1000 }),
			]);
			sites = s.data;
			params = p.data;
			siteParams = sp.data;

			const now = new Date();
			end = now.toISOString().slice(0, 16);
			start = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 16);
		} finally { loading = false; }
	});

	const availableParams = $derived(() => {
		if (selectedSiteIds.length === 0) return params;
		const paramIds = new Set(siteParams.filter((sp) => selectedSiteIds.includes(sp.site_id)).map((sp) => sp.parameter_id));
		return params.filter((p) => paramIds.has(p.id));
	});

	async function loadChartData() {
		if (selectedSiteIds.length === 0 || !selectedParamId || !start || !end) return;
		loadingData = true;
		chartData = [];
		try {
			const results = await Promise.all(
				selectedSiteIds.map(async (siteId) => {
					const site = sites.find((s) => s.id === siteId);
					const path = resolution === 'raw'
						? `/api/service/sites/${siteId}/readings`
						: `/api/service/sites/${siteId}/aggregates/${resolution}`;
					const data = await GET<{ data: Array<{ time: string; value: number }> }>(path, {
						start: new Date(start).toISOString(),
						end: new Date(end).toISOString(),
						parameter_ids: selectedParamId,
					});
					return {
						site: site?.name ?? siteId,
						times: data.data.map((r) => new Date(r.time).getTime()),
						values: data.data.map((r) => r.value),
					};
				}),
			);
			chartData = results;
		} catch {
			chartData = [];
		} finally { loadingData = false; }
	}

	function siteName(id: string): string { return sites.find((s) => s.id === id)?.name ?? id; }
</script>

<svelte:head><title>Compare Sites | River Data</title></svelte:head>

<div class="space-y-4">
	<h2 class="text-xl font-semibold">Compare Sites</h2>

	{#if loading}
		<p class="text-brand-muted">Loading...</p>
	{:else}
		<div class="flex gap-1 mb-4">
			<button onclick={() => mode = 'time'} class="px-3 py-1 text-sm rounded-md cursor-pointer border-none {mode === 'time' ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted'}">Time Series</button>
			<button onclick={() => mode = 'scatter'} class="px-3 py-1 text-sm rounded-md cursor-pointer border-none {mode === 'scatter' ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted'}">Scatter</button>
		</div>

		<div class="grid grid-cols-1 md:grid-cols-4 gap-4">
			<!-- Controls -->
			<div class="space-y-3">
				<div>
					<label class="text-sm font-medium block mb-1">Sites</label>
					<div class="space-y-1 max-h-40 overflow-y-auto border border-brand-divider rounded-md p-2">
						{#each sites as site}
							<label class="flex items-center gap-2 cursor-pointer text-sm">
								<input type="checkbox" value={site.id} bind:group={selectedSiteIds} class="w-3.5 h-3.5" />
								{site.name}
							</label>
						{/each}
					</div>
				</div>
				<div>
					<label for="param" class="text-sm font-medium block mb-1">Parameter</label>
					<select id="param" bind:value={selectedParamId} class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
						<option value="">— Select —</option>
						{#each availableParams() as p}
							<option value={p.id}>{p.display_name} ({p.default_units})</option>
						{/each}
					</select>
				</div>
				<div class="grid grid-cols-2 gap-2">
					<div>
						<label for="start" class="text-sm font-medium block mb-1">Start</label>
						<input id="start" type="datetime-local" bind:value={start} class="w-full px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-xs" />
					</div>
					<div>
						<label for="end" class="text-sm font-medium block mb-1">End</label>
						<input id="end" type="datetime-local" bind:value={end} class="w-full px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-xs" />
					</div>
				</div>
				<div>
					<label for="res" class="text-sm font-medium block mb-1">Resolution</label>
					<select id="res" bind:value={resolution} class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
						<option value="raw">Raw</option>
						<option value="hourly">Hourly</option>
						<option value="daily">Daily</option>
					</select>
				</div>
				<button onclick={loadChartData} disabled={selectedSiteIds.length === 0 || !selectedParamId || loadingData}
					class="w-full px-3 py-1.5 bg-brand-primary text-white rounded-md text-sm font-semibold cursor-pointer border-none disabled:opacity-50">
					{loadingData ? 'Loading...' : 'Compare'}
				</button>
			</div>

			<!-- Chart area -->
			<div class="md:col-span-3 rounded-md border border-brand-divider bg-brand-surface p-4 min-h-[400px]">
				{#if chartData.length === 0}
					<div class="flex items-center justify-center h-full text-brand-muted text-sm">
						Select sites and a parameter, then click Compare
					</div>
				{:else}
					<div class="space-y-2">
						<div class="flex gap-3 flex-wrap">
							{#each chartData as series, i}
								<div class="flex items-center gap-1.5 text-xs">
									<span class="w-3 h-0.5 rounded" style:background="var(--color-viz-{i})"></span>
									{series.site} ({series.values.length} points)
								</div>
							{/each}
						</div>
						<div class="h-[350px] bg-brand-bg rounded flex items-center justify-center text-sm text-brand-muted">
							Chart: {chartData.map((s) => s.site).join(' vs ')} — {chartData.reduce((sum, s) => sum + s.values.length, 0)} data points loaded
							<br />(uPlot chart integration pending)
						</div>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
