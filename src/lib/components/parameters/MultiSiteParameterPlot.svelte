<script lang="ts">
	import type uPlot from 'uplot';
	import UPlotChart from '$components/charts/UPlotChart.svelte';
	import TimeRangeSlider from '$components/charts/TimeRangeSlider.svelte';
	import ResolutionChips from '$components/charts/ResolutionChips.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import { uPlotTheme, makeSeries, makeAxis, makeGaps, GAP_THRESHOLDS, tzDateOption } from '$lib/charts/uPlotTheme';
	import {
		fetchSiteSeries,
		fetchSiteExtent,
		mergeSeries,
		autoResolution,
	} from '$lib/charts/multiSiteSeries';
	import { formatDate } from '$lib/utils';

	interface SiteOption {
		siteId: string;
		siteName: string;
		siteParameterId?: string;
		displayUnits?: string | null;
	}

	let {
		parameterId,
		parameterName,
		units = '',
		siteOptions,
		title = 'Time Series',
		emptyMessage = 'No sites measure this parameter.',
	}: {
		parameterId: string;
		parameterName: string;
		units?: string;
		siteOptions: SiteOption[];
		title?: string;
		emptyMessage?: string;
	} = $props();

	const DEFAULT_SITE_LIMIT = 5;

	let selectedSiteIds = $state<string[]>([]);

	// Slider bounds follow the selected sites' data extent; the selected window
	// starts as the full period and is clamped when bounds shrink.
	let sliderMin = $state(0);
	let sliderMax = $state(0);
	let start = $state(0);
	let end = $state(0);
	let boundsInitialized = false;

	interface LoadedSeries {
		siteId: string;
		label: string;
		seriesUnits: string;
		times: number[];
		values: (number | null)[];
	}
	let loaded = $state<LoadedSeries[]>([]);
	let failedSites = $state<string[]>([]);
	let loading = $state(false);
	let loadError = $state<string | null>(null);
	let fetchToken = 0;

	let initialized = false;
	$effect(() => {
		if (initialized || siteOptions.length === 0) return;
		initialized = true;
		selectedSiteIds = siteOptions.slice(0, DEFAULT_SITE_LIMIT).map((s) => s.siteId);
	});

	$effect(() => {
		const siteIds = [...selectedSiteIds];
		if (siteIds.length === 0) return;
		void refreshBounds(siteIds);
	});

	async function refreshBounds(siteIds: string[]) {
		const extents = await Promise.all(siteIds.map(fetchSiteExtent));
		const mins = extents.map((e) => e.min).filter((v): v is number => v != null);
		const maxs = extents.map((e) => e.max).filter((v): v is number => v != null);
		let newMin: number;
		let newMax: number;
		if (mins.length === 0 || maxs.length === 0) {
			newMax = Date.now();
			newMin = newMax - 30 * 86400000;
		} else {
			newMin = Math.min(...mins);
			newMax = Math.max(...maxs);
		}
		if (newMin >= newMax) return;
		sliderMin = newMin;
		sliderMax = newMax;
		if (!boundsInitialized) {
			boundsInitialized = true;
			start = newMin;
			end = newMax;
		} else {
			if (start < sliderMin) start = sliderMin;
			if (end > sliderMax) end = sliderMax;
			if (start >= end) { start = sliderMin; end = sliderMax; }
		}
	}

	function onSliderChange(s: number, e: number) {
		start = s;
		end = e;
	}

	function onZoomSelect(startMs: number, endMs: number) {
		if (endMs - startMs < 1000) return;
		start = Math.max(sliderMin, startMs);
		end = Math.min(sliderMax, endMs);
	}

	function onResetZoom() {
		start = sliderMin;
		end = sliderMax;
	}

	let resolutionOverride = $state<'auto' | 'raw' | 'hourly' | 'daily'>('auto');
	const resolution = $derived(
		resolutionOverride === 'auto' ? autoResolution(start, end) : resolutionOverride,
	);

	$effect(() => {
		void parameterId;
		void resolution;
		const siteIds = [...selectedSiteIds];
		const [startMs, endMs] = [start, end];
		if (!parameterId || siteIds.length === 0 || !startMs || !endMs) {
			loaded = [];
			failedSites = [];
			return;
		}
		const myToken = ++fetchToken;
		const handle = setTimeout(() => {
			void load(myToken, siteIds, startMs, endMs);
		}, 150);
		return () => clearTimeout(handle);
	});

	async function load(myToken: number, siteIds: string[], startMs: number, endMs: number) {
		loading = true;
		loadError = null;
		try {
			const res = resolution;
			const startIso = new Date(startMs).toISOString();
			const endIso = new Date(endMs).toISOString();

			const failed: string[] = [];
			const results = await Promise.all(
				siteIds.map(async (siteId): Promise<LoadedSeries> => {
					const opt = siteOptions.find((s) => s.siteId === siteId);
					const siteName = opt?.siteName ?? siteId;
					const seriesUnits =
						opt?.displayUnits && opt.displayUnits !== units ? opt.displayUnits : units;
					const label =
						seriesUnits !== units ? `${siteName} [${seriesUnits}]` : siteName;
					try {
						const { times, values } = await fetchSiteSeries({
							siteId,
							parameterId,
							siteParameterId: opt?.siteParameterId,
							start: startIso,
							end: endIso,
							resolution: res,
						});
						return { siteId, label, seriesUnits, times, values };
					} catch {
						failed.push(siteName);
						return { siteId, label, seriesUnits, times: [], values: [] };
					}
				}),
			);
			if (myToken !== fetchToken) return;
			if (failed.length === siteIds.length) {
				loaded = [];
				failedSites = [];
				loadError = 'Failed to load data for the selected sites.';
			} else {
				loaded = results;
				failedSites = failed;
			}
		} finally {
			if (myToken === fetchToken) loading = false;
		}
	}

	const pointCount = $derived(loaded.reduce((acc, s) => acc + s.times.length, 0));

	const mixedUnits = $derived(new Set(loaded.map((s) => s.seriesUnits)).size > 1);

	const chartData = $derived.by((): uPlot.AlignedData => mergeSeries(loaded));

	const chartOptions = $derived.by((): uPlot.Options => {
		const yLabel = `${parameterName}${units ? ' (' + units + ')' : ''}`;
		const gaps = makeGaps(GAP_THRESHOLDS[resolution] ?? 0);
		return {
			width: 800,
			height: 350,
			...tzDateOption(),
			scales: { x: { time: true }, y: { auto: true } },
			axes: [makeAxis({}), makeAxis({ size: 60, label: yLabel })],
			series: [
				{ label: 'Time' },
				...loaded.map((s, i) => ({ ...makeSeries(i, s.label, s.seriesUnits), gaps })),
			],
			legend: { show: uPlotTheme.legendShow },
			cursor: { drag: { x: true, y: false, setScale: false } },
			hooks: {
				setSelect: [
					(u: uPlot) => {
						if (u.select.width <= 0) return;
						const leftSec = u.posToVal(u.select.left, 'x');
						const rightSec = u.posToVal(u.select.left + u.select.width, 'x');
						u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
						onZoomSelect(leftSec * 1000, rightSec * 1000);
					},
				],
				ready: [
					(u: uPlot) => {
						u.root.addEventListener('dblclick', onResetZoom);
					},
				],
			},
		};
	});

</script>

<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
	<div class="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-brand-divider bg-brand-bg flex-wrap">
		<span class="text-sm font-semibold">{title}</span>
		{#if siteOptions.length > 0 && start && end}
			<div class="flex items-center gap-3 flex-wrap">
				<ResolutionChips bind:value={resolutionOverride} effective={autoResolution(start, end)} />
				<span class="text-xs text-brand-muted font-mono">
					{formatDate(new Date(start))} - {formatDate(new Date(end))}
				</span>
			</div>
		{/if}
	</div>

	{#if siteOptions.length === 0}
		<p class="text-sm text-brand-muted px-4 py-4">{emptyMessage}</p>
	{:else}
		<div class="grid grid-cols-1 md:grid-cols-5 gap-4 p-4">
			<div>
				<div class="flex items-center justify-between mb-1">
					<span class="text-sm font-medium">Sites</span>
					{#if siteOptions.length > DEFAULT_SITE_LIMIT}
						<span class="flex gap-1.5 text-xs">
							<button onclick={() => (selectedSiteIds = siteOptions.map((s) => s.siteId))} class="text-brand-primary bg-transparent border-none cursor-pointer p-0 hover:underline">All</button>
							<button onclick={() => (selectedSiteIds = [])} class="text-brand-primary bg-transparent border-none cursor-pointer p-0 hover:underline">None</button>
						</span>
					{/if}
				</div>
				<div class="space-y-1 max-h-60 overflow-y-auto border border-brand-divider rounded-md p-2">
					{#each siteOptions as opt}
						<label class="flex items-center gap-2 cursor-pointer text-sm">
							<input type="checkbox" value={opt.siteId} bind:group={selectedSiteIds} class="w-3.5 h-3.5" />
							{opt.siteName}
						</label>
					{/each}
				</div>
				{#if siteOptions.length > DEFAULT_SITE_LIMIT}
					<p class="mt-1 text-xs text-brand-muted">First {DEFAULT_SITE_LIMIT} sites shown by default.</p>
				{/if}
			</div>

			<div class="md:col-span-4 space-y-3">
				{#if sliderMin < sliderMax}
					<TimeRangeSlider min={sliderMin} max={sliderMax} bind:start bind:end onchange={onSliderChange} />
				{/if}
				<div class="min-h-[350px]">
					{#if selectedSiteIds.length === 0}
						<div class="flex items-center justify-center h-full text-brand-muted text-sm">Select at least one site.</div>
					{:else if loading && loaded.length === 0}
						<div class="flex items-center justify-center h-full text-brand-muted text-sm">Loading…</div>
					{:else if loadError}
						<div class="flex items-center h-full"><ErrorNotice message={loadError} /></div>
					{:else if pointCount === 0}
						<div class="flex items-center justify-center h-full text-brand-muted text-sm">
							No data available for the selected sites and time range.
						</div>
					{:else}
						<div class="space-y-2">
							<div class="flex gap-3 flex-wrap">
								{#each loaded as series, i}
									<div class="flex items-center gap-1.5 text-xs">
										<span class="w-3 h-0.5 rounded" style:background="var(--color-viz-{i})"></span>
										{series.label} ({series.times.length} points)
									</div>
								{/each}
							</div>
							<UPlotChart options={chartOptions} data={chartData} class="h-[350px]" />
							{#if failedSites.length > 0}
								<p class="text-xs text-severity-warning">Failed to load: {failedSites.join(', ')}</p>
							{/if}
							{#if mixedUnits}
								<p class="text-xs text-brand-muted">Sites report different display units; values share one axis.</p>
							{/if}
						</div>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>
