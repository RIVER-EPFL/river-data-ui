<script lang="ts">
	import type uPlot from 'uplot';
	import type { Site, Parameter, SiteParameter } from '$api/crud';
	import Button from '$components/ui/Button.svelte';
	import UPlotChart from '$components/charts/UPlotChart.svelte';
	import TimeRangeControls from '$components/charts/TimeRangeControls.svelte';
	import { uPlotTheme, makeSeries, makeAxis } from '$lib/charts/uPlotTheme';
	import { fetchSiteSeries, mergeSeries, type Frequency } from '$lib/charts/multiSiteSeries';
	import FrequencyChips from '$components/charts/FrequencyChips.svelte';

	let {
		sites,
		params,
		siteParams,
		selectedSiteIds = $bindable(),
		selectedParamId = $bindable(),
		resolution = $bindable(),
		frequency = $bindable(),
		start = $bindable(),
		end = $bindable(),
		statsOpen = $bindable(),
	}: {
		sites: Site[];
		params: Parameter[];
		siteParams: SiteParameter[];
		selectedSiteIds: string[];
		selectedParamId: string;
		resolution: 'raw' | 'hourly' | 'daily';
		frequency: Frequency;
		start: number;
		end: number;
		statsOpen: boolean;
	} = $props();

	// Data
	let chartData = $state<Array<{ site: string; times: number[]; values: (number | null)[]; spot?: boolean }>>([]);
	let loadingData = $state(false);

	const availableParams = $derived(() => {
		if (selectedSiteIds.length === 0) return params;
		const common = selectedSiteIds.reduce<Set<string> | null>((acc, siteId) => {
			const siteIds = new Set(
				siteParams.filter((sp) => sp.site_id === siteId).map((sp) => sp.parameter_id),
			);
			if (acc === null) return siteIds;
			return new Set([...acc].filter((id) => siteIds.has(id)));
		}, null) ?? new Set<string>();
		return params.filter((p) => common.has(p.id));
	});

	$effect(() => {
		if (selectedParamId && !availableParams().some((p) => p.id === selectedParamId)) {
			selectedParamId = '';
		}
	});

	let chartError = $state<string | null>(null);

	async function loadChartData() {
		if (selectedSiteIds.length === 0 || !selectedParamId || !start || !end) return;
		loadingData = true;
		chartError = null;
		chartData = [];
		try {
			const startIso = new Date(start).toISOString();
			const endIso = new Date(end).toISOString();
			const wantContinuous = frequency !== 'low';
			const wantSpot = frequency !== 'high';
			const results = await Promise.all(
				selectedSiteIds.map(async (siteId) => {
					const site = sites.find((s) => s.id === siteId);
					const sp = siteParams.find(
						(s) => s.site_id === siteId && s.parameter_id === selectedParamId,
					);
					const common = {
						siteId,
						parameterId: selectedParamId,
						siteParameterId: sp?.id,
						start: startIso,
						end: endIso,
					};
					const [cont, spot] = await Promise.all([
						wantContinuous
							? fetchSiteSeries({ ...common, resolution, measurementType: 'continuous' })
							: Promise.resolve(null),
						// Grab/spot samples are sparse and never aggregated — always fetched raw.
						wantSpot
							? fetchSiteSeries({ ...common, resolution: 'raw', measurementType: 'spot' }).catch(() => null)
							: Promise.resolve(null),
					]);
					const name = site?.name ?? siteId;
					const series: typeof chartData = [];
					if (cont) series.push({ site: name, times: cont.times, values: cont.values });
					if (spot && spot.times.length > 0) {
						series.push({ site: `${name} (grabs)`, times: spot.times, values: spot.values, spot: true });
					}
					return series;
				}),
			);
			chartData = results.flat();
			if (chartData.every((r) => r.times.length === 0)) {
				chartError = 'No data available for the selected sites, parameter, and time range.';
			}
		} catch {
			chartData = [];
			chartError = 'Failed to load comparison data.';
		} finally { loadingData = false; }
	}

	// Debounced auto-refresh: re-run the load whenever any input changes
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		// track dependencies
		void selectedSiteIds.length;
		void selectedParamId;
		void resolution;
		void frequency;
		void start;
		void end;
		if (selectedSiteIds.length === 0 || !selectedParamId || !start || !end) return;
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			void loadChartData();
		}, 100);
		return () => clearTimeout(debounceTimer);
	});

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
			const vals = series.values.filter((v): v is number => v != null && isFinite(v));
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

	const chartUPlotData = $derived.by((): uPlot.AlignedData => mergeSeries(chartData));

	const chartUPlotOptions = $derived.by((): uPlot.Options => {
		const param = params.find((p) => p.id === selectedParamId);
		const units = param?.default_units ?? '';
		const yLabel = param ? `${param.name}${units ? ' (' + units + ')' : ''}` : '';
		return {
			width: 800,
			height: 350,
			scales: { x: { time: true }, y: { auto: true } },
			axes: [makeAxis({}), makeAxis({ size: 60, label: yLabel })],
			series: [
				{ label: 'Time' },
				...chartData.map((s, i) =>
					s.spot
						? {
								...makeSeries(i, s.site, units),
								paths: () => null,
								points: { show: true, size: 7 },
							}
						: makeSeries(i, s.site, units),
				),
			],
			legend: { show: uPlotTheme.legendShow },
			cursor: { drag: { x: true, y: false } },
		};
	});
</script>

<div class="space-y-4">
	<div class="grid grid-cols-1 md:grid-cols-4 gap-4">
		<!-- Controls -->
		<div class="space-y-3">
			<div>
				<span class="text-sm font-medium block mb-1">Sites</span>
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
						<option value={p.id}>{p.name} ({p.default_units})</option>
					{/each}
				</select>
			</div>
			<TimeRangeControls siteIds={selectedSiteIds} bind:start bind:end />
			<div>
				<label for="res" class="text-sm font-medium block mb-1">Resolution</label>
				<select id="res" bind:value={resolution} class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
					<option value="raw">Raw</option>
					<option value="hourly">Hourly</option>
					<option value="daily">Daily</option>
				</select>
			</div>
			<div>
				<span class="text-sm font-medium block mb-1">Frequency</span>
				<FrequencyChips bind:value={frequency} />
			</div>
			<Button variant="primary" onclick={loadChartData} disabled={selectedSiteIds.length === 0 || !selectedParamId || loadingData}
				class="w-full">
				{loadingData ? 'Loading…' : 'Compare'}
			</Button>
		</div>

		<!-- Chart area -->
		<div class="md:col-span-3 rounded-md border border-brand-divider bg-brand-surface p-4 min-h-[400px]">
			{#if loadingData}
				<div class="flex items-center justify-center h-full text-brand-muted text-sm">Loading…</div>
			{:else if chartError}
				<div class="flex items-center justify-center h-full text-brand-muted text-sm">{chartError}</div>
			{:else if chartData.length === 0}
				<div class="flex items-center justify-center h-full text-brand-muted text-sm">
					Select sites and a parameter to compare
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
</div>
