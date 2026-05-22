<script lang="ts">
	import { onMount } from 'svelte';
	import type uPlot from 'uplot';
	import { api, type Site, type Parameter, type SiteParameter } from '$api/crud';
	import { GET } from '$api/client';
	import ScatterPlot from '$components/charts/ScatterPlot.svelte';
	import UPlotChart from '$components/charts/UPlotChart.svelte';
	import { uPlotTheme, makeSeries, makeAxis } from '$lib/charts/uPlotTheme';

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

	// Scatter selection
	let scatterSiteId = $state('');
	let scatterXParamId = $state('');
	let scatterYParamId = $state('');

	// Data
	let chartData = $state<Array<{ site: string; times: number[]; values: number[] }>>([]);
	let loadingData = $state(false);

	// Scatter data
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

	// Stats panel
	let statsOpen = $state(true);

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

	const scatterSiteParams = $derived(() => {
		if (!scatterSiteId) return [];
		return siteParams.filter((sp) => sp.site_id === scatterSiteId);
	});

	const scatterAvailableParams = $derived(() => {
		const spIds = new Set(scatterSiteParams().map((sp) => sp.parameter_id));
		return params.filter((p) => spIds.has(p.id));
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
						? `/api/v1/sites/${siteId}/readings`
						: `/api/v1/sites/${siteId}/aggregates/${resolution}`;
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

	async function loadScatterData() {
		if (!scatterSiteId || !scatterXParamId || !scatterYParamId || !start || !end) return;
		scatterLoading = true;
		scatterError = null;
		scatterData = null;
		try {
			interface ReadingsResponse {
				times: string[];
				parameters: Array<{ id: string; name: string; units: string | null; values: (number | null)[] }>;
			}
			const result = await GET<ReadingsResponse>(
				`/api/v1/sites/${scatterSiteId}/readings`,
				{
					start: new Date(start).toISOString(),
					end: new Date(end).toISOString(),
					parameter_ids: `${scatterXParamId},${scatterYParamId}`,
					page_size: 10000,
				},
			);

			const xParam = params.find((p) => p.id === scatterXParamId);
			const yParam = params.find((p) => p.id === scatterYParamId);
			const xSeries = result.parameters?.find((p) => p.id === scatterXParamId);
			const ySeries = result.parameters?.find((p) => p.id === scatterYParamId);

			if (!result.times?.length || !xSeries || !ySeries) {
				scatterError = 'No data available for the selected parameters and time range.';
				return;
			}

			const xSp = siteParams.find((sp) => sp.site_id === scatterSiteId && sp.parameter_id === scatterXParamId);
			const ySp = siteParams.find((sp) => sp.site_id === scatterSiteId && sp.parameter_id === scatterYParamId);

			scatterData = {
				xValues: xSeries.values,
				yValues: ySeries.values,
				times: result.times.map((t) => new Date(t).getTime() / 1000),
				xLabel: xParam?.display_name ?? 'X',
				yLabel: yParam?.display_name ?? 'Y',
				xUnits: xSp?.display_units ?? xParam?.default_units ?? '',
				yUnits: ySp?.display_units ?? yParam?.default_units ?? '',
			};
		} catch {
			scatterError = 'Failed to load scatter data';
		} finally { scatterLoading = false; }
	}

	// Per-parameter statistics for the stats panel
	interface ParamStats {
		site: string;
		n: number;
		mean: number;
		min: number;
		max: number;
		stddev: number;
	}

	const compareStats = $derived.by((): ParamStats[] => {
		return chartData.map((series) => {
			const vals = series.values.filter((v) => v != null && isFinite(v));
			const n = vals.length;
			if (n === 0) return { site: series.site, n: 0, mean: 0, min: 0, max: 0, stddev: 0 };
			const sum = vals.reduce((a, b) => a + b, 0);
			const mean = sum / n;
			const min = Math.min(...vals);
			const max = Math.max(...vals);
			const variance = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / n;
			const stddev = Math.sqrt(variance);
			return { site: series.site, n, mean, min, max, stddev };
		});
	});

	function siteName(id: string): string { return sites.find((s) => s.id === id)?.name ?? id; }

	const chartUPlotData = $derived.by((): uPlot.AlignedData => {
		if (chartData.length === 0) return [[]];
		const allTimes = new Set<number>();
		for (const s of chartData) for (const t of s.times) allTimes.add(t);
		const sorted = Array.from(allTimes).sort((a, b) => a - b);
		const xs = sorted.map((t) => t / 1000);
		const ys: (number | null)[][] = chartData.map((s) => {
			const lookup = new Map<number, number>();
			for (let i = 0; i < s.times.length; i++) lookup.set(s.times[i], s.values[i]);
			return sorted.map((t) => lookup.get(t) ?? null);
		});
		return [xs, ...ys] as uPlot.AlignedData;
	});

	const chartUPlotOptions = $derived.by((): uPlot.Options => {
		const param = params.find((p) => p.id === selectedParamId);
		const units = param?.default_units ?? '';
		const yLabel = param ? `${param.display_name}${units ? ' (' + units + ')' : ''}` : '';
		return {
			width: 800,
			height: 350,
			scales: { x: { time: true }, y: { auto: true } },
			axes: [makeAxis({}), makeAxis({ size: 60, label: yLabel })],
			series: [
				{ label: 'Time' },
				...chartData.map((s, i) => makeSeries(i, s.site, units)),
			],
			legend: { show: uPlotTheme.legendShow },
			cursor: { drag: { x: true, y: false } },
		};
	});
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

		{#if mode === 'time'}
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
							<option value="">-- Select --</option>
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
							<UPlotChart options={chartUPlotOptions} data={chartUPlotData} class="h-[350px]" />
						</div>
					{/if}
				</div>
			</div>

			<!-- Stats panel -->
			{#if chartData.length > 0}
				<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
					<button
						onclick={() => statsOpen = !statsOpen}
						class="w-full flex items-center justify-between px-4 py-2.5 bg-brand-bg border-none cursor-pointer text-left"
					>
						<span class="text-sm font-semibold">Statistics</span>
						<span class="text-xs text-brand-muted">{statsOpen ? 'Collapse' : 'Expand'}</span>
					</button>
					{#if statsOpen}
						<div class="px-4 py-3">
							<table class="w-full text-sm">
								<thead>
									<tr class="border-b border-brand-divider">
										<th class="text-left py-1.5 font-semibold">Site</th>
										<th class="text-right py-1.5 font-semibold">n</th>
										<th class="text-right py-1.5 font-semibold">Mean</th>
										<th class="text-right py-1.5 font-semibold">Min</th>
										<th class="text-right py-1.5 font-semibold">Max</th>
										<th class="text-right py-1.5 font-semibold">Std Dev</th>
									</tr>
								</thead>
								<tbody>
									{#each compareStats as stat}
										<tr class="border-b border-brand-divider last:border-b-0">
											<td class="py-1.5 font-medium">{stat.site}</td>
											<td class="py-1.5 text-right font-mono text-xs">{stat.n}</td>
											<td class="py-1.5 text-right font-mono text-xs">{stat.n > 0 ? stat.mean.toFixed(3) : '--'}</td>
											<td class="py-1.5 text-right font-mono text-xs">{stat.n > 0 ? stat.min.toFixed(3) : '--'}</td>
											<td class="py-1.5 text-right font-mono text-xs">{stat.n > 0 ? stat.max.toFixed(3) : '--'}</td>
											<td class="py-1.5 text-right font-mono text-xs">{stat.n > 0 ? stat.stddev.toFixed(3) : '--'}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				</div>
			{/if}

		{:else}
			<!-- Scatter mode -->
			<div class="grid grid-cols-1 md:grid-cols-4 gap-4">
				<!-- Scatter controls -->
				<div class="space-y-3">
					<div>
						<label for="scatter-site" class="text-sm font-medium block mb-1">Site</label>
						<select id="scatter-site" bind:value={scatterSiteId} class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
							<option value="">-- Select site --</option>
							{#each sites as site}
								<option value={site.id}>{site.name}</option>
							{/each}
						</select>
					</div>
					<div>
						<label for="scatter-x" class="text-sm font-medium block mb-1">X Axis</label>
						<select id="scatter-x" bind:value={scatterXParamId} disabled={!scatterSiteId} class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm disabled:opacity-50">
							<option value="">-- Select --</option>
							{#each scatterAvailableParams() as p}
								<option value={p.id} disabled={p.id === scatterYParamId}>{p.display_name} ({p.default_units})</option>
							{/each}
						</select>
					</div>
					<div>
						<label for="scatter-y" class="text-sm font-medium block mb-1">Y Axis</label>
						<select id="scatter-y" bind:value={scatterYParamId} disabled={!scatterSiteId} class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm disabled:opacity-50">
							<option value="">-- Select --</option>
							{#each scatterAvailableParams() as p}
								<option value={p.id} disabled={p.id === scatterXParamId}>{p.display_name} ({p.default_units})</option>
							{/each}
						</select>
					</div>
					<div class="grid grid-cols-2 gap-2">
						<div>
							<label for="scatter-start" class="text-sm font-medium block mb-1">Start</label>
							<input id="scatter-start" type="datetime-local" bind:value={start} class="w-full px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-xs" />
						</div>
						<div>
							<label for="scatter-end" class="text-sm font-medium block mb-1">End</label>
							<input id="scatter-end" type="datetime-local" bind:value={end} class="w-full px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-xs" />
						</div>
					</div>
					<button onclick={loadScatterData} disabled={!scatterSiteId || !scatterXParamId || !scatterYParamId || scatterLoading}
						class="w-full px-3 py-1.5 bg-brand-primary text-white rounded-md text-sm font-semibold cursor-pointer border-none disabled:opacity-50">
						{scatterLoading ? 'Loading...' : 'Plot'}
					</button>
				</div>

				<!-- Scatter chart area -->
				<div class="md:col-span-3 rounded-md border border-brand-divider bg-brand-surface p-4 min-h-[400px]">
					{#if scatterLoading}
						<div class="flex items-center justify-center h-full text-brand-muted text-sm">Loading scatter data...</div>
					{:else if scatterError}
						<div class="flex items-center justify-center h-full text-brand-muted text-sm">{scatterError}</div>
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
							Select a site and two parameters, then click Plot
						</div>
					{/if}
				</div>
			</div>
		{/if}
	{/if}
</div>
