<script lang="ts">
	import type uPlot from 'uplot';
	import { seriesColor, seriesDash, swatchStyle } from '$lib/charts/legend';
	import type { Site, Parameter, SiteParameter } from '$api/crud';
	import type { TimeSeriesSpec } from '$lib/explore/chartSpecs';
	import Button from '$components/ui/Button.svelte';
	import UPlotChart from '$components/charts/UPlotChart.svelte';
	import TimeRangeControls from '$components/charts/TimeRangeControls.svelte';
	import { uPlotTheme, makeSeries, makeAxis } from '$lib/charts/uPlotTheme';
	import { fetchSiteSeries, mergeSeries } from '$lib/charts/multiSiteSeries';
	import FrequencyChips from '$components/charts/FrequencyChips.svelte';
	import { formatMeasurement, NO_VALUE } from '$lib/format';
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
		spec: TimeSeriesSpec;
		index: number;
		removable: boolean;
		onremove: () => void;
	} = $props();

	let chartData = $state<Array<{ site: string; units: string | null; times: number[]; values: (number | null)[]; spot?: boolean }>>([]);
	let loadingData = $state(false);
	let chartError = $state<string | null>(null);
	let statsOpen = $state(true);

	const availableParams = $derived(() => {
		if (spec.siteIds.length === 0) return params;
		const common = spec.siteIds.reduce<Set<string> | null>((acc, siteId) => {
			const siteIds = new Set(
				siteParams.filter((sp) => sp.site_id === siteId).map((sp) => sp.parameter_id),
			);
			if (acc === null) return siteIds;
			return new Set([...acc].filter((id) => siteIds.has(id)));
		}, null) ?? new Set<string>();
		return params.filter((p) => common.has(p.id));
	});

	$effect(() => {
		if (spec.paramId && !availableParams().some((p) => p.id === spec.paramId)) {
			spec.paramId = '';
		}
	});

	const ready = $derived(spec.siteIds.length > 0 && !!spec.paramId && !!spec.start && !!spec.end);
	const title = $derived.by(() => {
		const param = params.find((p) => p.id === spec.paramId)?.name;
		const names = spec.siteIds.map((id) => sites.find((s) => s.id === id)?.name ?? id);
		return param && names.length > 0 ? `${param}: ${names.join(', ')}` : `Chart ${index + 1}`;
	});

	async function loadChartData() {
		if (!ready) return;
		const { siteIds, paramId, resolution, frequency, start, end } = spec;
		loadingData = true;
		chartError = null;
		chartData = [];
		try {
			const startIso = new Date(start).toISOString();
			const endIso = new Date(end).toISOString();
			const wantContinuous = frequency !== 'low';
			const wantSpot = frequency !== 'high';
			const results = await Promise.all(
				siteIds.map(async (siteId) => {
					const site = sites.find((s) => s.id === siteId);
					const sp = siteParams.find((s) => s.site_id === siteId && s.parameter_id === paramId);
					const common = {
						siteId,
						parameterId: paramId,
						siteParameterId: sp?.id,
						start: startIso,
						end: endIso,
					};
					const [cont, spot] = await Promise.all([
						wantContinuous
							? fetchSiteSeries({ ...common, resolution, measurementType: 'continuous' })
							: Promise.resolve(null),
						// Grab/spot samples are sparse and never aggregated, always fetched raw.
						wantSpot
							? fetchSiteSeries({ ...common, resolution: 'raw', measurementType: 'spot' }).catch(() => null)
							: Promise.resolve(null),
					]);
					const name = site?.name ?? siteId;
					// Sites can serve one parameter in different units (ppb against ppt), which is
					// exactly the comparison this tab is for, so every series carries its own.
					const seriesUnits =
						sp?.display_units ?? params.find((p) => p.id === paramId)?.default_units ?? null;
					const series: typeof chartData = [];
					if (cont) series.push({ site: name, units: seriesUnits, times: cont.times, values: cont.values });
					if (spot && spot.times.length > 0) {
						series.push({ site: `${name} (grabs)`, units: seriesUnits, times: spot.times, values: spot.values, spot: true });
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
		} finally {
			loadingData = false;
		}
	}

	// Debounced auto-refresh: re-run the load whenever any input changes
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		void spec.siteIds.length;
		void spec.paramId;
		void spec.resolution;
		void spec.frequency;
		void spec.start;
		void spec.end;
		if (!ready) return;
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			void loadChartData();
		}, 100);
		return () => clearTimeout(debounceTimer);
	});

	interface ParamStats {
		site: string;
		units: string | null;
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
			if (n === 0) return { site: series.site, units: series.units, n: 0, mean: 0, min: 0, max: 0, stddev: 0 };
			const sum = vals.reduce((a, b) => a + b, 0);
			const mean = sum / n;
			const min = Math.min(...vals);
			const max = Math.max(...vals);
			const variance = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / n;
			const stddev = Math.sqrt(variance);
			return { site: series.site, units: series.units, n, mean, min, max, stddev };
		});
	});

	const chartUPlotData = $derived.by((): uPlot.AlignedData => mergeSeries(chartData));

	const chartUPlotOptions = $derived.by((): uPlot.Options => {
		const param = params.find((p) => p.id === spec.paramId);
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

	const id = $derived(`ts-${index}`);
</script>

<ChartCard {title} {removable} {onremove}>
	{#snippet controls()}
		<div>
			<span class="text-sm font-medium block mb-1">Sites</span>
			<div class="space-y-1 max-h-40 overflow-y-auto border border-brand-divider rounded-md p-2">
				{#each sites as site}
					<label class="flex items-center gap-2 cursor-pointer text-sm">
						<input type="checkbox" value={site.id} bind:group={spec.siteIds} class="w-3.5 h-3.5" />
						{site.name}
					</label>
				{/each}
			</div>
		</div>
		<div>
			<label for="{id}-param" class="text-sm font-medium block mb-1">Parameter</label>
			<select id="{id}-param" bind:value={spec.paramId} class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
				<option value="">-- Select --</option>
				{#each availableParams() as p}
					<option value={p.id}>{p.name} ({p.default_units})</option>
				{/each}
			</select>
		</div>
		<TimeRangeControls siteIds={spec.siteIds} bind:start={spec.start} bind:end={spec.end} />
		<div>
			<label for="{id}-res" class="text-sm font-medium block mb-1">Resolution</label>
			<select id="{id}-res" bind:value={spec.resolution} class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
				<option value="raw">Raw</option>
				<option value="hourly">Hourly</option>
				<option value="daily">Daily</option>
			</select>
		</div>
		<div>
			<span class="text-sm font-medium block mb-1">Frequency</span>
			<FrequencyChips bind:value={spec.frequency} />
		</div>
		<Button variant="primary" onclick={loadChartData} disabled={!ready || loadingData} class="w-full">
			{loadingData ? 'Loading…' : 'Compare'}
		</Button>
	{/snippet}
	{#snippet chart()}
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
							<span class="w-3 h-0.5 rounded" style={swatchStyle(seriesColor(i), seriesDash(i))}></span>
							{series.site} ({series.values.length} points)
						</div>
					{/each}
				</div>
				<UPlotChart options={chartUPlotOptions} data={chartUPlotData} class="h-[350px]" />
			</div>
		{/if}
	{/snippet}
	{#snippet footer()}
		{#if chartData.length > 0}
			<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
				<button
					onclick={() => (statsOpen = !statsOpen)}
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
										<td class="py-1.5 font-medium">
											{stat.site}
											{#if stat.units}<span class="font-normal text-brand-muted">({stat.units})</span>{/if}
										</td>
										<td class="py-1.5 text-right font-mono text-xs">{stat.n}</td>
										<td class="py-1.5 text-right font-mono text-xs">{stat.n > 0 ? formatMeasurement(stat.mean) : NO_VALUE}</td>
										<td class="py-1.5 text-right font-mono text-xs">{stat.n > 0 ? formatMeasurement(stat.min) : NO_VALUE}</td>
										<td class="py-1.5 text-right font-mono text-xs">{stat.n > 0 ? formatMeasurement(stat.max) : NO_VALUE}</td>
										<td class="py-1.5 text-right font-mono text-xs">{stat.n > 0 ? formatMeasurement(stat.stddev) : NO_VALUE}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>
		{/if}
	{/snippet}
</ChartCard>
