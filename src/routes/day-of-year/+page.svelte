<script lang="ts">
	import type uPlot from 'uplot';
	import { onMount } from 'svelte';
	import { api, type Parameter, type Site, type SiteParameter } from '$api/crud';
	import { fetchSiteSeries } from '$lib/charts/multiSiteSeries';
	import { uPlotTheme, makeSeries, makeAxis } from '$lib/charts/uPlotTheme';
	import { tokens } from '$lib/charts/tokens';
	import UPlotChart from '$components/charts/UPlotChart.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';

	// Full-year overlays are always drawn at daily resolution: one point per calendar
	// day keeps the folded axis readable and the request count bounded.
	const RESOLUTION = 'daily' as const;

	// Day-of-year is expressed in a fixed 366-day leap-year frame so the same calendar
	// date lands on the same x across leap and non-leap years. Feb-29 occupies day 60
	// (leap years only); every date from Mar-1 onward is shifted +1 in non-leap years so
	// month boundaries stay aligned. Month starts are therefore constant in this frame.
	const DAYS_IN_FRAME = 366;
	const MONTH_STARTS = [1, 32, 61, 92, 122, 153, 183, 214, 245, 275, 306, 336];
	const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

	function isLeapYear(y: number): boolean {
		return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
	}

	/** Map a UTC timestamp (ms) to a 1..366 day-of-year in the leap-year frame. */
	function dayOfYearInFrame(ts: number): number {
		const d = new Date(ts);
		const year = d.getUTCFullYear();
		const startOfYear = Date.UTC(year, 0, 1);
		const startOfDay = Date.UTC(year, d.getUTCMonth(), d.getUTCDate());
		const rawDoy = Math.floor((startOfDay - startOfYear) / 86400000) + 1;
		// In non-leap years, Mar-1 (raw 60) onward is shifted +1 to align with the leap frame.
		if (!isLeapYear(year) && rawDoy >= 60) return rawDoy + 1;
		return rawDoy;
	}

	const currentYear = new Date().getUTCFullYear();
	const candidateYears = Array.from({ length: 6 }, (_, i) => currentYear - i);

	let parameters = $state<Parameter[]>([]);
	let sites = $state<Site[]>([]);
	let siteParameters = $state<SiteParameter[]>([]);
	let pageLoading = $state(true);
	let pageError = $state<string | null>(null);

	let selectedParameterId = $state<string>('');
	let selectedSiteIds = $state<string[]>([]);
	let selectedYears = $state<number[]>([currentYear, currentYear - 1, currentYear - 2]);

	onMount(async () => {
		try {
			const [p, s, sp] = await Promise.all([
				api.parameters.list({ perPage: 500 }),
				api.sites.list({ perPage: 200 }),
				api.siteParameters.list({ perPage: 1000, filter: { is_active: true } }),
			]);
			sites = s.data;
			siteParameters = sp.data;
			// Only offer parameters that are actually measured somewhere.
			const measured = new Set(sp.data.map((x) => x.parameter_id));
			parameters = p.data.filter((x) => measured.has(x.id)).sort((a, b) => a.name.localeCompare(b.name));
			selectedParameterId = parameters[0]?.id ?? '';
		} catch (e) {
			pageError = e instanceof Error ? e.message : 'Failed to load metadata';
		} finally {
			pageLoading = false;
		}
	});

	function siteName(siteId: string): string {
		return sites.find((s) => s.id === siteId)?.name ?? siteId;
	}

	const selectedParam = $derived(parameters.find((p) => p.id === selectedParameterId) ?? null);
	const units = $derived(selectedParam?.default_units ?? '');

	interface SiteOption {
		siteId: string;
		siteName: string;
		siteParameterId: string;
		displayUnits: string | null;
	}

	const siteOptions = $derived.by((): SiteOption[] =>
		siteParameters
			.filter((sp) => sp.parameter_id === selectedParameterId)
			.map((sp) => ({
				siteId: sp.site_id,
				siteName: siteName(sp.site_id),
				siteParameterId: sp.id,
				displayUnits: sp.display_units,
			}))
			.sort((a, b) => a.siteName.localeCompare(b.siteName)),
	);

	// When the parameter changes, default to plotting every site that measures it.
	let lastParamForSites = '';
	$effect(() => {
		const pid = selectedParameterId;
		if (!pid || pid === lastParamForSites) return;
		lastParamForSites = pid;
		selectedSiteIds = siteOptions.map((o) => o.siteId);
	});

	interface OverlaySeries {
		label: string;
		doy: number[];
		values: (number | null)[];
	}
	let loaded = $state<OverlaySeries[]>([]);
	let failed = $state<string[]>([]);
	let loading = $state(false);
	let loadError = $state<string | null>(null);
	let fetchToken = 0;

	$effect(() => {
		const pid = selectedParameterId;
		const siteIds = [...selectedSiteIds];
		const years = [...selectedYears].sort((a, b) => a - b);
		const opts = siteOptions;
		if (!pid || siteIds.length === 0 || years.length === 0) {
			loaded = [];
			failed = [];
			return;
		}
		const myToken = ++fetchToken;
		const handle = setTimeout(() => {
			void load(myToken, pid, siteIds, years, opts);
		}, 150);
		return () => clearTimeout(handle);
	});

	async function load(
		myToken: number,
		parameterId: string,
		siteIds: string[],
		years: number[],
		opts: SiteOption[],
	) {
		loading = true;
		loadError = null;
		try {
			const combos: { opt: SiteOption; year: number }[] = [];
			for (const siteId of siteIds) {
				const opt = opts.find((o) => o.siteId === siteId);
				if (!opt) continue;
				for (const year of years) combos.push({ opt, year });
			}

			const failedLabels: string[] = [];
			const results = await Promise.all(
				combos.map(async ({ opt, year }): Promise<OverlaySeries> => {
					const label = `${opt.siteName} ${year}`;
					try {
						const { times, values } = await fetchSiteSeries({
							siteId: opt.siteId,
							parameterId,
							siteParameterId: opt.siteParameterId,
							start: `${year}-01-01T00:00:00Z`,
							end: `${year}-12-31T23:59:59Z`,
							resolution: RESOLUTION,
						});
						return { label, doy: times.map(dayOfYearInFrame), values };
					} catch {
						failedLabels.push(label);
						return { label, doy: [], values: [] };
					}
				}),
			);
			if (myToken !== fetchToken) return;
			// Drop empty series so the legend and palette only reflect years/sites with data.
			loaded = results.filter((r) => r.doy.length > 0);
			failed = failedLabels;
			if (failedLabels.length === combos.length) {
				loaded = [];
				loadError = 'Failed to load data for the selected sites and years.';
			}
		} finally {
			if (myToken === fetchToken) loading = false;
		}
	}

	const pointCount = $derived(loaded.reduce((acc, s) => acc + s.doy.length, 0));

	/** Align every overlay onto a shared 1..366 leap-frame x-axis. */
	const chartData = $derived.by((): uPlot.AlignedData => {
		const xs = Array.from({ length: DAYS_IN_FRAME }, (_, i) => i + 1);
		const ys = loaded.map((s) => {
			const arr = new Array<number | null>(DAYS_IN_FRAME).fill(null);
			for (let i = 0; i < s.doy.length; i++) {
				const d = s.doy[i];
				if (d >= 1 && d <= DAYS_IN_FRAME) arr[d - 1] = s.values[i];
			}
			return arr;
		});
		return [xs, ...ys] as uPlot.AlignedData;
	});

	const chartOptions = $derived.by((): uPlot.Options => {
		const yLabel = `${selectedParam?.name ?? 'Value'}${units ? ' (' + units + ')' : ''}`;
		return {
			width: 800,
			height: 350,
			scales: { x: { time: false, range: [1, DAYS_IN_FRAME] }, y: { auto: true } },
			axes: [
				makeAxis({
					label: 'Day of year',
					splits: () => MONTH_STARTS,
					values: (_u: uPlot, splits: number[]) =>
						splits.map((s) => MONTH_LABELS[MONTH_STARTS.indexOf(s)] ?? ''),
				}),
				makeAxis({ size: 60, label: yLabel }),
			],
			series: [
				{ label: 'Day of year' },
				...loaded.map((s, i) => makeSeries(i, s.label, units)),
			],
			legend: { show: uPlotTheme.legendShow },
			cursor: { drag: { x: false, y: false } },
		};
	});
</script>

<svelte:head><title>Day of Year | River Data</title></svelte:head>

<div class="space-y-6">
	<div>
		<h2 class="text-xl font-semibold">Day of Year</h2>
		<p class="text-sm text-brand-muted mt-1">
			Seasonal overlay: each year of a parameter is folded onto a shared annual axis so recurring
			patterns line up across years.
		</p>
	</div>

	{#if pageLoading}
		<p class="text-brand-muted">Loading…</p>
	{:else if pageError}
		<ErrorNotice message={pageError} />
	{:else if parameters.length === 0}
		<p class="text-sm text-brand-muted">No measured parameters available.</p>
	{:else}
		<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
			<div class="grid grid-cols-1 md:grid-cols-5 gap-4 p-4">
				<div class="space-y-4">
					<div>
						<label for="doy-param" class="text-sm font-medium block mb-1">Parameter</label>
						<select
							id="doy-param"
							bind:value={selectedParameterId}
							class="w-full text-sm border border-brand-divider rounded-md bg-brand-surface px-2 py-1.5"
						>
							{#each parameters as p}
								<option value={p.id}>{p.name}{p.default_units ? ` (${p.default_units})` : ''}</option>
							{/each}
						</select>
					</div>

					<div>
						<div class="flex items-center justify-between mb-1">
							<span class="text-sm font-medium">Sites</span>
							{#if siteOptions.length > 1}
								<span class="flex gap-1.5 text-xs">
									<button
										onclick={() => (selectedSiteIds = siteOptions.map((o) => o.siteId))}
										class="text-brand-primary bg-transparent border-none cursor-pointer p-0 hover:underline"
									>All</button>
									<button
										onclick={() => (selectedSiteIds = [])}
										class="text-brand-primary bg-transparent border-none cursor-pointer p-0 hover:underline"
									>None</button>
								</span>
							{/if}
						</div>
						{#if siteOptions.length === 0}
							<p class="text-xs text-brand-muted">No sites measure this parameter.</p>
						{:else}
							<div class="space-y-1 max-h-48 overflow-y-auto border border-brand-divider rounded-md p-2">
								{#each siteOptions as opt}
									<label class="flex items-center gap-2 cursor-pointer text-sm">
										<input type="checkbox" value={opt.siteId} bind:group={selectedSiteIds} class="w-3.5 h-3.5" />
										{opt.siteName}
									</label>
								{/each}
							</div>
						{/if}
					</div>

					<div>
						<span class="text-sm font-medium block mb-1">Years</span>
						<div class="flex flex-wrap gap-1.5">
							{#each candidateYears as year}
								{@const active = selectedYears.includes(year)}
								<button
									onclick={() =>
										(selectedYears = active
											? selectedYears.filter((y) => y !== year)
											: [...selectedYears, year])}
									class="px-2 py-1 text-xs rounded-md border cursor-pointer {active
										? 'bg-brand-primary text-white border-brand-primary'
										: 'bg-brand-surface text-brand-text border-brand-divider hover:bg-brand-bg'}"
								>{year}</button>
							{/each}
						</div>
					</div>
				</div>

				<div class="md:col-span-4">
					<div class="min-h-[350px]">
						{#if selectedSiteIds.length === 0}
							<div class="flex items-center justify-center h-full text-brand-muted text-sm">Select at least one site.</div>
						{:else if selectedYears.length === 0}
							<div class="flex items-center justify-center h-full text-brand-muted text-sm">Select at least one year.</div>
						{:else if loading && loaded.length === 0}
							<div class="flex items-center justify-center h-full text-brand-muted text-sm">Loading…</div>
						{:else if loadError}
							<div class="flex items-center h-full"><ErrorNotice message={loadError} /></div>
						{:else if pointCount === 0}
							<div class="flex items-center justify-center h-full text-brand-muted text-sm">
								No data available for the selected sites and years.
							</div>
						{:else}
							<div class="space-y-2">
								<div class="flex gap-3 flex-wrap">
									{#each loaded as series, i}
										<div class="flex items-center gap-1.5 text-xs">
											<span class="w-3 h-0.5 rounded" style:background={tokens.dataViz[i % tokens.dataViz.length]}></span>
											{series.label} ({series.doy.length} points)
										</div>
									{/each}
								</div>
								<UPlotChart options={chartOptions} data={chartData} class="h-[350px]" />
								{#if failed.length > 0}
									<p class="text-xs text-severity-warning">Failed to load: {failed.join(', ')}</p>
								{/if}
							</div>
						{/if}
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>
