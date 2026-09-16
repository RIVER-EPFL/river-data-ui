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
	import {
		spotMarkersPlugin,
		spotSeriesConfig,
		spotWhiskerExtent,
		type SpotPointStats,
		type SpotSeriesSpec,
	} from '$lib/charts/spotMarkers';
	import { spotDispersion } from '$lib/charts/spotSummary';
	import { spotMarkerColors } from '$lib/charts/legend';
	import ChartKey from '$components/charts/ChartKey.svelte';
	import type { ChartKeyPresence } from '$lib/charts/chartKey';
	import FrequencyChips from '$components/charts/FrequencyChips.svelte';
	import { formatMeasurement, NO_VALUE } from '$lib/format';
	import { getSiteStatistics, type ParameterStatistics } from '$api/service';
	import ChartCard from './ChartCard.svelte';
	import SharedChartTooltip from '$components/charts/SharedChartTooltip.svelte';
	import { getChartSyncGroup, cursorSyncPlugin } from '$lib/charts/chart-sync.svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';

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

	let chartData = $state<Array<{ site: string; siteId: string; siteParameterId?: string; units: string | null; times: number[]; values: (number | null)[]; spot?: boolean; stats?: Map<number, SpotPointStats> }>>([]);
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
							? fetchSiteSeries({
									...common,
									resolution: 'raw',
									measurementType: 'spot',
									includeSampleStats: true,
								}).catch(() => null)
							: Promise.resolve(null),
					]);
					const name = site?.name ?? siteId;
					// Sites can serve one parameter in different units (ppb against ppt), which is
					// exactly the comparison this tab is for, so every series carries its own.
					const seriesUnits =
						sp?.display_units ?? params.find((p) => p.id === paramId)?.default_units ?? null;
					const series: typeof chartData = [];
					if (cont)
						series.push({
							site: name,
							siteId,
							siteParameterId: sp?.id,
							units: seriesUnits,
							times: cont.times,
							values: cont.values,
						});
					if (spot && spot.times.length > 0) {
						series.push({
							site: `${name} (grabs)`,
							siteId,
							siteParameterId: sp?.id,
							units: seriesUnits,
							times: spot.times,
							values: spot.values,
							spot: true,
							stats: spot.stats,
						});
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
			void loadPeriodStats();
		}, 100);
		return () => clearTimeout(debounceTimer);
	});

	/**
	 * The period statistics, computed server-side over the values the API serves, so the same range
	 * reads the same in the portal and in Explore.
	 */
	interface PeriodStatsRow {
		site: string;
		siteId: string;
		units: string | null;
		stats: ParameterStatistics | null;
	}
	let periodStats = $state<PeriodStatsRow[]>([]);

	async function loadPeriodStats() {
		const { siteIds, paramId, start, end, frequency } = spec;
		if (!ready) {
			periodStats = [];
			return;
		}
		const measurementType = frequency === 'low' ? 'spot' : 'continuous';
		const rows = await Promise.all(
			siteIds.map(async (siteId) => {
				const site = sites.find((s) => s.id === siteId);
				const label = site?.name ?? siteId;
				try {
					const result = await getSiteStatistics(siteId, {
						start: new Date(start).toISOString(),
						end: new Date(end).toISOString(),
						parameter_ids: paramId,
						measurement_type: measurementType,
					});
					const stats = result.parameters[0] ?? null;
					return { site: label, siteId, units: stats?.units ?? null, stats };
				} catch {
					return { site: label, siteId, units: null, stats: null };
				}
			})
		);
		periodStats = rows;
	}

	const chartUPlotData = $derived.by((): uPlot.AlignedData => mergeSeries(chartData));

	// uPlot ranges y from the plotted means, so an sd bar wider than their spread is clipped.
	function yRange(u: uPlot, dataMin: number | null, dataMax: number | null): [number, number] {
		const fallback = [dataMin ?? 0, dataMax ?? 1] as [number, number];
		const extent = spotWhiskerExtent(chartData.flatMap((s) => [...(s.stats?.values() ?? [])]));
		if (!extent) return fallback;
		const lo = Math.min(fallback[0], extent[0]);
		const hi = Math.max(fallback[1], extent[1]);
		const pad = (hi - lo) * 0.05 || 1;
		return [lo - pad, hi + pad];
	}

	const spotSpecs = $derived.by((): SpotSeriesSpec[] =>
		chartData
			.map((s, i) => ({ s, i }))
			.filter(({ s }) => s.spot)
			.map(({ s, i }) => ({
				seriesIdx: i + 1,
				...spotMarkerColors(i),
				stats: new Map([...(s.stats?.entries() ?? [])].map(([ms, stat]) => [ms / 1000, stat])),
			})),
	);

	const keyPresence = $derived.by<ChartKeyPresence>(() => {
		const stats = chartData.flatMap((s) => [...(s.stats?.values() ?? [])]);
		const dispersions = new Set(stats.map((st) => spotDispersion(st)));
		const unitSet = new Set(chartData.map((s) => s.units ?? ''));
		return {
			line: chartData.some((s) => !s.spot),
			spot: chartData.some((s) => s.spot),
			spotAgreed: dispersions.has('agreed'),
			spotSingle: dispersions.has('single'),
			sdBar: dispersions.has('spread'),
			units: unitSet.size === 1 ? ([...unitSet][0] || null) : null,
		};
	});

	const chartUPlotOptions = $derived.by((): uPlot.Options => {
		const param = params.find((p) => p.id === spec.paramId);
		const units = param?.default_units ?? '';
		const yLabel = param ? `${param.name}${units ? ' (' + units + ')' : ''}` : '';
		return {
			width: 800,
			height: 350,
			scales: { x: { time: true }, y: { auto: true, range: yRange } },
			axes: [makeAxis({}), makeAxis({ size: 60, label: yLabel })],
			series: [
				{ label: 'Time' },
				// One spot path across the app: the transparent series ranges the y-scale and the
				// shared plugin paints the marks, so a grab reads the same here as on the site page.
				...chartData.map((s, i) =>
					s.spot ? spotSeriesConfig(s.site) : makeSeries(i, s.site, units),
				),
			],
			plugins: [spotMarkersPlugin(() => spotSpecs), cursorSyncPlugin(syncGroup, syncKey)],
			legend: { show: uPlotTheme.legendShow },
			cursor: { drag: { x: true, y: false } },
		};
	});

	const id = $derived(`ts-${index}`);
	const syncKey = $derived(`explore-ts-${index}`);
	const syncGroup = $derived(getChartSyncGroup(syncKey));

	// The tooltip reads whatever is registered, so each site's series registers itself against the
	// merged x-axis the plot draws on. Without this the Explore charts hover blank.
	$effect(() => {
		const xs = (chartUPlotData[0] ?? []) as number[];
		const values = chartUPlotData.slice(1) as (number | null)[][];
		syncGroup.clear();
		chartData.forEach((series, i) => {
			syncGroup.register({
				id: `${syncKey}-${i}`,
				parameterName: series.site,
				units: series.units ?? '',
				paletteIndex: i,
				times: xs,
				values: values[i] ?? [],
				spotStats: series.stats ?? null,
			});
		});
		return () => syncGroup.clear();
	});

	/** A spot point's full record lives on its own site page, which already renders it. */
	function openSpotRecord(): void {
		const c = syncGroup.cursor;
		if (!c) return;
		const xs = (chartUPlotData[0] ?? []) as number[];
		const ts = xs[c.idx];
		if (ts == null) return;
		const series = chartData.find(
			(s) => s.spot && s.siteParameterId && s.stats?.has(ts * 1000),
		);
		if (!series?.siteParameterId) return;
		const params = new URLSearchParams({
			point: series.siteParameterId,
			t: new Date(ts * 1000).toISOString(),
			mt: 'spot',
		});
		void goto(`${base}/sites/${series.siteId}?${params.toString()}`);
	}
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
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div onclick={openSpotRecord}>
					<UPlotChart options={chartUPlotOptions} data={chartUPlotData} class="h-[350px]" />
				</div>
				<ChartKey presence={keyPresence} />
				<SharedChartTooltip {syncKey} />
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
									<th class="text-right py-1.5 font-semibold">Time points</th>
									<th class="text-right py-1.5 font-semibold">n</th>
									<th class="text-right py-1.5 font-semibold">NA's</th>
									<th class="text-right py-1.5 font-semibold">Median</th>
									<th class="text-right py-1.5 font-semibold">Mean</th>
									<th class="text-right py-1.5 font-semibold" title="Divides by n-1, matching R's sd()">SD (sample, n-1)</th>
									<th class="text-right py-1.5 font-semibold">Min</th>
									<th class="text-right py-1.5 font-semibold">Max</th>
								</tr>
							</thead>
							<tbody>
								{#each periodStats as row}
									{@const s = row.stats}
									{@const d = s?.decimal_places ?? null}
									<tr class="border-b border-brand-divider last:border-b-0">
										<td class="py-1.5 font-medium">
											{row.site}
											{#if row.units}<span class="font-normal text-brand-muted">({row.units})</span>{/if}
										</td>
										<td class="py-1.5 text-right font-mono text-xs">{s?.time_points ?? 0}</td>
										<td class="py-1.5 text-right font-mono text-xs">{s?.n ?? 0}</td>
										<td class="py-1.5 text-right font-mono text-xs">{s?.nulls ?? 0}</td>
										<td class="py-1.5 text-right font-mono text-xs">{s?.n ? formatMeasurement(s.median, d) : NO_VALUE}</td>
										<td class="py-1.5 text-right font-mono text-xs">{s?.n ? formatMeasurement(s.mean, d) : NO_VALUE}</td>
										<td class="py-1.5 text-right font-mono text-xs">{s?.n ? formatMeasurement(s.stdev_sample, d) : NO_VALUE}</td>
										<td class="py-1.5 text-right font-mono text-xs">{s?.n ? formatMeasurement(s.min, d) : NO_VALUE}</td>
										<td class="py-1.5 text-right font-mono text-xs">{s?.n ? formatMeasurement(s.max, d) : NO_VALUE}</td>
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
