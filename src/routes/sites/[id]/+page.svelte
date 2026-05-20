<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { api, type Site, type Project, type SiteParameter, type Parameter, type Sensor, type SensorDeployment, type SensorCalibration, type Note, type AlarmThreshold, type DerivedParameter, type Sample } from '$api/crud';
	import { GET, POST, PATCH } from '$api/client';
	import { recomputeDerived } from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatRelativeTime, formatDateTime } from '$lib/utils';
	import Tabs from '$components/ui/Tabs.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import ParameterChart, { type ChartData } from '$components/charts/ParameterChart.svelte';
	import SharedChartTooltip from '$components/charts/SharedChartTooltip.svelte';
	import TimeRangeSlider from '$components/charts/TimeRangeSlider.svelte';

	let site = $state<Site | null>(null);
	let project = $state<Project | null>(null);
	let siteParameters = $state<SiteParameter[]>([]);
	let parameters = $state<Parameter[]>([]);
	let sensors = $state<Sensor[]>([]);
	let deployments = $state<SensorDeployment[]>([]);
	let calibrations = $state<SensorCalibration[]>([]);
	let notes = $state<Note[]>([]);
	let thresholds = $state<AlarmThreshold[]>([]);
	let derivedDefs = $state<DerivedParameter[]>([]);
	let samples = $state<Sample[]>([]);
	let samplesLoading = $state(false);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let activeTab = $state(0);
	let statsOpen = $state(false);
	let recomputingId = $state<string | null>(null);

	// Scatter tab state
	let scatterXParamId = $state('');
	let scatterYParamId = $state('');

	// Shared chart state
	const cursorSyncKey = 'site-charts';
	let resolutionOverride = $state<'auto' | 'raw' | 'hourly' | 'daily'>('auto');

	const sliderMax = $state(Date.now());
	const sliderMin = $state(Date.now() - 90 * 86400000);
	let chartStart = $state(Date.now() - 604800000);
	let chartEnd = $state(Date.now());

	let sliderRef: TimeRangeSlider | undefined = $state();

	function autoResolution(startMs: number, endMs: number): 'raw' | 'hourly' | 'daily' {
		const days = (endMs - startMs) / 86400000;
		if (days <= 14) return 'raw';
		if (days <= 120) return 'hourly';
		return 'daily';
	}

	const chartResolution = $derived<'raw' | 'hourly' | 'daily'>(
		resolutionOverride === 'auto' ? autoResolution(chartStart, chartEnd) : resolutionOverride
	);

	const windowDuration = $derived((chartEnd - chartStart) / 86400000);
	const windowLabel = $derived.by(() => {
		const days = windowDuration;
		if (days < 1) return `${Math.round(days * 24)}h`;
		if (days < 60) return `${Math.round(days)}d`;
		return `${(days / 30).toFixed(1)}mo`;
	});

	// Shared data fetch — one request for all charts
	interface ReadingsResponse {
		times: string[];
		parameters: Array<{ id: string; name: string; units: string | null; values: (number | null)[] }>;
	}
	interface AggregatesResponse {
		times: string[];
		parameters: Array<{ id: string; name: string; units: string | null; avg: (number | null)[]; min: (number | null)[]; max: (number | null)[]; count: number[] }>;
	}

	let chartLoading = $state(false);
	let chartDataMap = $state<Map<string, ChartData>>(new Map());
	let fetchGeneration = 0;
	let fetchTimer: ReturnType<typeof setTimeout> | null = null;

	function scheduleFetch() {
		if (fetchTimer) clearTimeout(fetchTimer);
		fetchTimer = setTimeout(() => { fetchTimer = null; doFetch(); }, 50);
	}

	async function doFetch() {
		chartLoading = true;
		const gen = ++fetchGeneration;
		const startDate = new Date(chartStart).toISOString();
		const endDate = new Date(chartEnd).toISOString();

		try {
			const res = chartResolution;
			let parsedTimes: number[] = [];
			const map = new Map<string, ChartData>();

			if (res === 'raw') {
				const result = await GET<ReadingsResponse>(
					`/api/service/sites/${siteId}/readings`,
					{ start: startDate, end: endDate },
				);
				if (gen !== fetchGeneration) return;
				if (result.times?.length) {
					parsedTimes = result.times.map((t) => new Date(t).getTime() / 1000);
					for (const p of result.parameters ?? []) {
						map.set(p.id, { times: parsedTimes, values: p.values });
					}
				}
			} else {
				const result = await GET<AggregatesResponse>(
					`/api/service/sites/${siteId}/aggregates/${res}`,
					{ start: startDate, end: endDate },
				);
				if (gen !== fetchGeneration) return;
				if (result.times?.length) {
					parsedTimes = result.times.map((t) => new Date(t).getTime() / 1000);
					for (const p of result.parameters ?? []) {
						map.set(p.id, { times: parsedTimes, values: p.avg, mins: p.min, maxs: p.max });
					}
				}
			}

			chartDataMap = map;
		} catch (e) {
			if (gen === fetchGeneration) {
				toastStore.error('Failed to load chart data');
				chartDataMap = new Map();
			}
		} finally {
			if (gen === fetchGeneration) chartLoading = false;
		}
	}

	function updateChartRange(range: string) {
		const rangeMs: Record<string, number> = { '24h': 86400000, '7d': 604800000, '30d': 2592000000, '90d': 7776000000 };
		chartEnd = Date.now();
		chartStart = chartEnd - rangeMs[range];
		scheduleFetch();
	}

	function onSliderChange(start: number, end: number) {
		chartStart = start;
		chartEnd = end;
		scheduleFetch();
	}

	function onChartZoomSelect(startMs: number, endMs: number) {
		chartStart = startMs;
		chartEnd = endMs;
		scheduleFetch();
	}

	function onChartResetZoom() {
		chartStart = sliderMin;
		chartEnd = sliderMax;
		scheduleFetch();
	}

	const activeRange = $derived.by(() => {
		const rangeMs: Record<string, number> = { '24h': 86400000, '7d': 604800000, '30d': 2592000000, '90d': 7776000000 };
		const dur = chartEnd - chartStart;
		for (const [key, ms] of Object.entries(rangeMs)) {
			if (Math.abs(dur - ms) < 60000) return key;
		}
		return null;
	});

	// Notes
	let addNoteOpen = $state(false);
	let newNoteText = $state('');
	let savingNote = $state(false);

	// Export dialog
	let exportOpen = $state(false);
	let exportStart = $state('');
	let exportEnd = $state('');
	let exportFormat = $state<'csv' | 'json' | 'ndjson'>('csv');
	let exportResolution = $state<'raw' | 'hourly' | 'daily'>('hourly');
	let exportLoading = $state(false);

	// Status events
	let statusEvents = $state<Array<{ time: string; stream_id: string; status: string }>>([]);
	let statusTimeRange = $state<'24h' | '7d' | '30d'>('24h');
	let statusLoading = $state(false);

	const siteId = $derived(page.params.id!);

	onMount(async () => {
		try {
			const s = await api.sites.get(siteId);
			site = s;

			const [proj, sp, params, sens, deps, cals, n, th] = await Promise.all([
				api.projects.get(s.project_id),
				api.siteParameters.list({ perPage: 100, filter: { site_id: siteId } }),
				api.parameters.list({ perPage: 500 }),
				api.sensors.list({ perPage: 200 }),
				api.sensorDeployments.list({ perPage: 200, filter: { site_id: siteId } }),
				api.sensorCalibrations.list({ perPage: 500 }),
				api.notes.list({ perPage: 50, filter: { site_id: siteId }, sort: ['created_at', 'DESC'] }),
				api.alarmThresholds.list({ perPage: 100, filter: { site_id: siteId } }),
			]);
			project = proj;
			siteParameters = sp.data;
			parameters = params.data;
			sensors = sens.data;
			deployments = deps.data;
			calibrations = cals.data;
			notes = n.data;
			thresholds = th.data;

			const [derivedResult, derivedSourcesResult, samplesResult] = await Promise.all([
				api.derivedParameters.list({ perPage: 200 }),
				api.derivedParameterSources.list({ perPage: 500 }),
				api.samples.list({ perPage: 200, filter: { site_id: siteId }, sort: ['collected_at', 'DESC'] }),
			]);
			derivedDefs = derivedResult.data.map((d) => ({
				...d,
				sources: derivedSourcesResult.data.filter((s) => s.derived_definition_id === d.id),
			}));
			samples = samplesResult.data;

			const now = new Date();
			exportEnd = now.toISOString().slice(0, 16);
			exportStart = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 16);

			scheduleFetch();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load site';
		} finally { loading = false; }
	});

	function paramName(paramId: string): string { return parameters.find((p) => p.id === paramId)?.display_name ?? '—'; }
	function paramUnits(sp: SiteParameter): string {
		const param = parameters.find((p) => p.id === sp.parameter_id);
		return sp.display_units ?? param?.default_units ?? '';
	}

	// Sensor helpers
	const activeSensorIds = $derived(new Set(deployments.filter((d) => !d.deployed_until).map((d) => d.sensor_id)));
	const deployedSensors = $derived(sensors.filter((s) => activeSensorIds.has(s.id)));

	function sensorDeployment(sensorId: string): SensorDeployment | undefined {
		return deployments.find((d) => d.sensor_id === sensorId && !d.deployed_until);
	}

	function sensorLatestCalibration(sensorId: string): SensorCalibration | undefined {
		return calibrations.filter((c) => c.sensor_id === sensorId).sort((a, b) => new Date(b.valid_from).getTime() - new Date(a.valid_from).getTime())[0];
	}

	// Notes
	async function addNote() {
		if (!newNoteText.trim()) return;
		savingNote = true;
		try {
			const note = await api.notes.create({ site_id: siteId, text: newNoteText.trim() });
			notes = [note as Note, ...notes];
			newNoteText = '';
			addNoteOpen = false;
			toastStore.success('Note added');
		} catch { toastStore.error('Failed to add note'); }
		finally { savingNote = false; }
	}

	async function deleteNote(id: string) {
		try { await api.notes.remove(id); notes = notes.filter((n) => n.id !== id); toastStore.success('Note deleted'); }
		catch { toastStore.error('Failed to delete note'); }
	}

	// Status events
	async function loadStatusEvents() {
		statusLoading = true;
		const hours = statusTimeRange === '24h' ? 24 : statusTimeRange === '7d' ? 168 : 720;
		const start = new Date(Date.now() - hours * 3600000).toISOString();
		try {
			const spIds = siteParameters.map((sp) => sp.id).join(',');
			if (!spIds) { statusEvents = []; return; }
			const result = await GET<{ data: Array<{ time: string; stream_id: string; status: string }> }>(
				`/api/service/sites/${siteId}/status_events`, { start, page_size: 200 }
			);
			statusEvents = result.data ?? [];
		} catch { statusEvents = []; }
		finally { statusLoading = false; }
	}

	// Export
	async function handleExport() {
		if (!exportStart || !exportEnd) return;
		exportLoading = true;
		try {
			const path = exportResolution === 'raw'
				? `/api/service/sites/${siteId}/readings`
				: `/api/service/sites/${siteId}/aggregates/${exportResolution}`;
			const url = `${path}?start=${new Date(exportStart).toISOString()}&end=${new Date(exportEnd).toISOString()}&format=${exportFormat}`;

			const response = await fetch(url, { headers: { 'Authorization': `Bearer ${(await import('$auth/keycloak.svelte')).auth.token}` } });
			const blob = await response.blob();
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = `${site?.name ?? 'export'}_${exportResolution}.${exportFormat === 'ndjson' ? 'ndjson' : exportFormat}`;
			a.click();
			URL.revokeObjectURL(a.href);
			toastStore.success('Export downloaded');
			exportOpen = false;
		} catch { toastStore.error('Export failed'); }
		finally { exportLoading = false; }
	}

	// Derived parameters
	const siteParameterIds = $derived(new Set(siteParameters.map((sp) => sp.parameter_id)));
	const assignedDerivedIds = $derived(new Set(
		siteParameters.filter((sp) => sp.is_derived && sp.derived_definition_id).map((sp) => sp.derived_definition_id!)
	));

	// Derived defs that are assigned to this site
	const assignedDerivedDefs = $derived(
		derivedDefs.filter((d) => assignedDerivedIds.has(d.id))
	);

	// Availability check for each unassigned derived def
	const availableDerivedDefs = $derived(
		derivedDefs
			.filter((d) => !assignedDerivedIds.has(d.id))
			.map((d) => {
				const sources = d.sources ?? [];
				const present = sources.filter((s) => siteParameterIds.has(s.parameter_id));
				const missing = sources.filter((s) => !siteParameterIds.has(s.parameter_id));
				return { def: d, allPresent: missing.length === 0 && sources.length > 0, present, missing };
			})
	);

	let showAssignDerived = $state(false);
	let assigningId = $state<string | null>(null);

	async function handleRecompute(id: string) {
		recomputingId = id;
		try {
			await recomputeDerived(id);
			toastStore.success('Derived parameter recomputed');
		} catch {
			toastStore.error('Failed to recompute derived parameter');
		} finally {
			recomputingId = null;
		}
	}

	async function assignDerived(def: DerivedParameter) {
		if (!def.output_parameter_id) {
			toastStore.error('No output parameter — recompute the definition first');
			return;
		}
		assigningId = def.id;
		try {
			await api.siteParameters.create({
				site_id: siteId,
				parameter_id: def.output_parameter_id,
				is_derived: true,
				derived_definition_id: def.id,
				display_units: def.units || null,
				name: def.name,
				sensor_type: 'derived',
			});
			toastStore.success(`${def.display_name || def.name} assigned`);
			const sp = await api.siteParameters.list({ perPage: 200, filter: { site_id: siteId } });
			siteParameters = sp.data;
			showAssignDerived = false;
			await recomputeDerived(def.id);
			toastStore.success('Recomputation triggered');
		} catch (e) {
			toastStore.error(`Failed: ${e instanceof Error ? e.message : 'unknown error'}`);
		} finally {
			assigningId = null;
		}
	}

	async function unassignDerived(sp: SiteParameter) {
		try {
			await api.siteParameters.remove(sp.id);
			toastStore.success('Derived parameter removed');
			const result = await api.siteParameters.list({ perPage: 200, filter: { site_id: siteId } });
			siteParameters = result.data;
		} catch {
			toastStore.error('Failed to remove');
		}
	}

	// Statistics helpers (inline)
	function calcMean(vals: (number | null)[]): number | null {
		const nums = vals.filter((v): v is number => v != null);
		if (nums.length === 0) return null;
		return nums.reduce((a, b) => a + b, 0) / nums.length;
	}
	function calcStddev(vals: (number | null)[]): number | null {
		const nums = vals.filter((v): v is number => v != null);
		if (nums.length < 2) return null;
		const m = nums.reduce((a, b) => a + b, 0) / nums.length;
		const variance = nums.reduce((a, b) => a + (b - m) ** 2, 0) / (nums.length - 1);
		return Math.sqrt(variance);
	}
	function calcMin(vals: (number | null)[]): number | null {
		const nums = vals.filter((v): v is number => v != null);
		return nums.length > 0 ? Math.min(...nums) : null;
	}
	function calcMax(vals: (number | null)[]): number | null {
		const nums = vals.filter((v): v is number => v != null);
		return nums.length > 0 ? Math.max(...nums) : null;
	}
	function calcNullPct(vals: (number | null)[]): number {
		if (vals.length === 0) return 0;
		return (vals.filter((v) => v == null).length / vals.length) * 100;
	}
	function fmt(val: number | null, decimals = 2): string {
		return val != null ? val.toFixed(decimals) : '—';
	}

	interface ParamStats {
		name: string;
		units: string;
		count: number;
		mean: number | null;
		min: number | null;
		max: number | null;
		stddev: number | null;
		nullPct: number;
	}

	const chartStats = $derived.by((): ParamStats[] => {
		const result: ParamStats[] = [];
		for (const sp of measurementParams) {
			const param = parameters.find((p) => p.id === sp.parameter_id);
			if (!param) continue;
			const data = chartDataMap.get(sp.id);
			if (!data) continue;
			const vals = data.values;
			result.push({
				name: param.display_name,
				units: sp.display_units ?? param.default_units ?? '',
				count: vals.length,
				mean: calcMean(vals),
				min: calcMin(vals),
				max: calcMax(vals),
				stddev: calcStddev(vals),
				nullPct: calcNullPct(vals),
			});
		}
		return result;
	});

	// Calibration history per sensor
	function sensorCalibrations(sensorId: string): SensorCalibration[] {
		return calibrations
			.filter((c) => c.sensor_id === sensorId)
			.sort((a, b) => new Date(b.valid_from).getTime() - new Date(a.valid_from).getTime());
	}
	function isActiveCalibration(cal: SensorCalibration): boolean {
		const now = new Date();
		const from = new Date(cal.valid_from);
		const until = cal.valid_until ? new Date(cal.valid_until) : null;
		return from <= now && (until == null || until > now);
	}

	// Measurement params for charts (exclude device_health)
	const measurementParams = $derived(
		siteParameters.filter((sp) => {
			const param = parameters.find((p) => p.id === sp.parameter_id);
			return param && param.category !== 'device_health';
		})
	);
</script>

<svelte:head><title>{site?.name ?? 'Site'} | River Data</title></svelte:head>

{#if loading}
	<p class="text-brand-muted">Loading site...</p>
{:else if error}
	<div class="text-severity-alarm">
		<p>Error: {error}</p>
		<a href="{base}/sites" class="text-brand-primary">Back to sites</a>
	</div>
{:else if site}
	<div class="space-y-4">
		<!-- Header -->
		<div class="flex items-start justify-between">
			<div>
				<div class="flex items-center gap-2 text-sm text-brand-muted mb-1">
					<a href="{base}/sites" class="hover:text-brand-primary no-underline">Sites</a>
					<span>/</span>
					{#if project}<span>{project.name}</span><span>/</span>{/if}
				</div>
				<h2 class="text-xl font-semibold">{site.name}</h2>
				{#if site.description}<p class="text-sm text-brand-muted mt-1">{site.description}</p>{/if}
				{#if site.latitude && site.longitude}
					<p class="text-xs font-mono text-brand-muted mt-1">{site.latitude.toFixed(6)}, {site.longitude.toFixed(6)} {site.altitude_m ? `· ${site.altitude_m}m` : ''}</p>
				{/if}
			</div>
			<div class="flex gap-2">
				<button onclick={() => exportOpen = true} class="px-3 py-1.5 border border-brand-divider bg-brand-surface text-sm rounded-md cursor-pointer hover:bg-brand-bg">Export</button>
				<a href="{base}/sites/{site.id}/edit" class="px-3 py-1.5 border border-brand-divider bg-brand-surface text-sm rounded-md no-underline text-brand-text hover:bg-brand-bg">Edit</a>
			</div>
		</div>

		<Tabs tabs={['Charts', 'Parameters', 'Sensors', 'Samples', 'Status', 'Notes', 'Scatter']} bind:active={activeTab} />

		<!-- Charts tab -->
		{#if activeTab === 0}
			<div class="space-y-3">
				<!-- Shared time controls -->
				<div class="rounded-md border border-brand-divider bg-brand-surface px-4 py-3 space-y-3">
					<div class="flex items-center gap-3 flex-wrap">
						<span class="text-xs text-brand-muted font-semibold uppercase tracking-wider">Range</span>
						<div class="flex gap-0.5">
							{#each ['24h', '7d', '30d', '90d'] as range}
								<button
									onclick={() => updateChartRange(range)}
									class="px-2.5 py-1 text-xs rounded cursor-pointer border-none {activeRange === range ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted hover:text-brand-text'}"
								>{range}</button>
							{/each}
						</div>

						<div class="w-px h-5 bg-brand-divider mx-1"></div>

						<span class="text-xs text-brand-muted font-semibold uppercase tracking-wider">Resolution</span>
						<div class="flex gap-0.5">
							{#each [['auto', 'Auto'], ['raw', 'Raw'], ['hourly', 'Hourly'], ['daily', 'Daily']] as [val, label]}
								<button
									onclick={() => { resolutionOverride = val as typeof resolutionOverride; scheduleFetch(); }}
									class="px-2 py-1 text-xs rounded cursor-pointer border-none {resolutionOverride === val ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted hover:text-brand-text'}"
								>{label}{resolutionOverride === 'auto' && val === 'auto' ? ` (${chartResolution})` : ''}</button>
							{/each}
						</div>

						<span class="text-xs text-brand-muted ml-auto font-mono">
							{windowLabel} · {new Date(chartStart).toLocaleDateString()} — {new Date(chartEnd).toLocaleDateString()}
						</span>
					</div>
					<!-- Time slider -->
					<TimeRangeSlider
						bind:this={sliderRef}
						min={sliderMin}
						max={sliderMax}
						bind:start={chartStart}
						bind:end={chartEnd}
						onchange={onSliderChange}
					/>
				</div>

				<!-- Statistics (collapsible) -->
				{#if chartStats.length > 0}
					<div class="rounded-md border border-brand-divider bg-brand-surface">
						<button
							onclick={() => statsOpen = !statsOpen}
							class="w-full flex items-center justify-between px-4 py-2.5 text-sm font-semibold cursor-pointer border-none bg-transparent text-brand-text hover:bg-brand-bg"
						>
							<span>Statistics ({windowLabel})</span>
							<span class="text-xs text-brand-muted">{statsOpen ? 'Hide' : 'Show'}</span>
						</button>
						{#if statsOpen}
							<div class="border-t border-brand-divider overflow-x-auto">
								<table class="w-full text-xs">
									<thead><tr class="bg-brand-bg">
										<th class="text-left px-3 py-1.5 font-semibold">Parameter</th>
										<th class="text-right px-3 py-1.5 font-semibold">Count</th>
										<th class="text-right px-3 py-1.5 font-semibold">Mean</th>
										<th class="text-right px-3 py-1.5 font-semibold">Min</th>
										<th class="text-right px-3 py-1.5 font-semibold">Max</th>
										<th class="text-right px-3 py-1.5 font-semibold">Stddev</th>
										<th class="text-right px-3 py-1.5 font-semibold">% Null</th>
									</tr></thead>
									<tbody>
										{#each chartStats as s}
											<tr class="border-t border-brand-divider">
												<td class="px-3 py-1.5 font-medium">{s.name} <span class="text-brand-muted">({s.units})</span></td>
												<td class="px-3 py-1.5 text-right font-mono">{s.count}</td>
												<td class="px-3 py-1.5 text-right font-mono">{fmt(s.mean)}</td>
												<td class="px-3 py-1.5 text-right font-mono">{fmt(s.min)}</td>
												<td class="px-3 py-1.5 text-right font-mono">{fmt(s.max)}</td>
												<td class="px-3 py-1.5 text-right font-mono">{fmt(s.stddev)}</td>
												<td class="px-3 py-1.5 text-right font-mono">{fmt(s.nullPct, 1)}%</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/if}
					</div>
				{/if}

				<!-- Charts -->
				{#each measurementParams as sp, i}
					{@const param = parameters.find((p) => p.id === sp.parameter_id)}
					{@const th = thresholds.find((t) => t.parameter_id === sp.parameter_id)}
					{#if param}
						<ParameterChart
							siteId={siteId}
							siteParameterId={sp.id}
							parameterId={sp.parameter_id}
							parameterName={param.display_name}
							units={sp.display_units ?? param.default_units}
							threshold={th}
							seriesIndex={i}
							syncKey={cursorSyncKey}
							chartData={chartDataMap.get(sp.id) ?? null}
							loading={chartLoading}
							onZoomSelect={onChartZoomSelect}
							onResetZoom={onChartResetZoom}
						/>
					{/if}
				{/each}
				{#if measurementParams.length === 0}
					<p class="text-sm text-brand-muted">No parameters configured for this site.</p>
				{/if}
			</div>

			<!-- Shared tooltip (positioned fixed, reads from all charts) -->
			<SharedChartTooltip syncKey={cursorSyncKey} />

		<!-- Parameters tab -->
		{:else if activeTab === 1}
			<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
				<table class="w-full text-sm">
					<thead><tr class="bg-brand-bg border-b border-brand-divider">
						<th class="text-left px-4 py-2 font-semibold">Parameter</th>
						<th class="text-left px-4 py-2 font-semibold">Units</th>
						<th class="text-left px-4 py-2 font-semibold">Interval</th>
						<th class="text-left px-4 py-2 font-semibold">Thresholds</th>
					</tr></thead>
					<tbody>
						{#each siteParameters.filter((sp) => !sp.is_derived) as sp}
							{@const th = thresholds.find((t) => t.parameter_id === sp.parameter_id)}
							<tr class="border-b border-brand-divider last:border-b-0">
								<td class="px-4 py-2 font-semibold">{paramName(sp.parameter_id)}</td>
								<td class="px-4 py-2 text-brand-muted">{paramUnits(sp)}</td>
								<td class="px-4 py-2 text-brand-muted">{sp.sample_interval_sec ? `${sp.sample_interval_sec}s` : '—'}</td>
								<td class="px-4 py-2 text-xs text-brand-muted">
									{#if th}
										<span class="text-severity-warning">W: {th.warning_min ?? '—'}–{th.warning_max ?? '—'}</span>
										<span class="text-severity-alarm ml-2">A: {th.alarm_min ?? '—'}–{th.alarm_max ?? '—'}</span>
									{:else}
										—
									{/if}
								</td>
							</tr>
						{/each}
						{#if siteParameters.filter((sp) => !sp.is_derived).length === 0}
							<tr><td colspan="4" class="px-4 py-6 text-center text-brand-muted">No parameters configured</td></tr>
						{/if}
					</tbody>
				</table>
			</div>

			<!-- Derived Parameters -->
				<div class="mt-4 rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
					<div class="flex items-center justify-between px-4 py-3 bg-brand-bg border-b border-brand-divider">
						<span class="text-sm font-semibold">Derived Parameters ({assignedDerivedDefs.length})</span>
						<button
							onclick={() => showAssignDerived = !showAssignDerived}
							class="px-2 py-1 text-xs border border-brand-divider rounded bg-brand-surface cursor-pointer hover:bg-brand-bg"
						>{showAssignDerived ? 'Cancel' : 'Assign'}</button>
					</div>

					{#if showAssignDerived}
						<div class="p-4 border-b border-brand-divider bg-brand-bg/50 space-y-2">
							<p class="text-xs text-brand-muted">Select a derived parameter to assign to this site. Greyed out entries are missing required source parameters.</p>
							{#each availableDerivedDefs as { def, allPresent, missing }}
								<div class="flex items-center justify-between p-2 rounded border border-brand-divider {allPresent ? 'bg-brand-surface' : 'bg-brand-bg opacity-60'}">
									<div class="flex-1">
										<span class="text-sm font-medium">{def.display_name || def.name}</span>
										<span class="text-xs font-mono text-brand-muted ml-2">{def.formula}</span>
										{#if missing.length > 0}
											<p class="text-xs text-severity-alarm mt-0.5">
												Missing: {missing.map((s) => s.variable_name).join(', ')}
											</p>
										{/if}
									</div>
									<button
										onclick={() => assignDerived(def)}
										disabled={!allPresent || assigningId === def.id}
										class="px-2 py-1 text-xs rounded bg-brand-primary text-white cursor-pointer hover:bg-brand-primary-dark disabled:opacity-40 disabled:cursor-not-allowed"
									>{assigningId === def.id ? 'Assigning...' : 'Assign'}</button>
								</div>
							{:else}
								<p class="text-xs text-brand-muted py-2">No unassigned derived parameters available. <a href="{base}/derived/new" class="text-brand-primary no-underline hover:underline">Create one</a></p>
							{/each}
						</div>
					{/if}

					{#if assignedDerivedDefs.length > 0}
						<table class="w-full text-sm">
							<thead><tr class="bg-brand-bg border-b border-brand-divider">
								<th class="text-left px-4 py-2 font-semibold">Name</th>
								<th class="text-left px-4 py-2 font-semibold">Formula</th>
								<th class="text-left px-4 py-2 font-semibold">Sources</th>
								<th class="text-right px-4 py-2 font-semibold">Actions</th>
							</tr></thead>
							<tbody>
								{#each assignedDerivedDefs as d}
									{@const sp = siteParameters.find((s) => s.derived_definition_id === d.id)}
									<tr class="border-b border-brand-divider last:border-b-0">
										<td class="px-4 py-2 font-medium">
											<a href="{base}/derived/{d.id}" class="text-brand-primary no-underline hover:underline">{d.display_name || d.name}</a>
										</td>
										<td class="px-4 py-2 font-mono text-xs text-brand-muted">{d.formula}</td>
										<td class="px-4 py-2 text-xs text-brand-muted">
											{#each d.sources ?? [] as src}
												{@const available = siteParameterIds.has(src.parameter_id)}
												<span class="inline-block mr-1.5" class:text-severity-alarm={!available}>
													<span class="font-mono">{src.variable_name}</span>
													{#if !available}(missing){/if}
												</span>
											{/each}
										</td>
										<td class="px-4 py-2 text-right whitespace-nowrap">
											<ConfirmPopover message="Recompute this derived parameter?" confirmLabel="Recompute" onconfirm={() => handleRecompute(d.id)}>
												<button
													disabled={recomputingId === d.id}
													class="px-2 py-1 text-xs rounded border border-brand-divider bg-brand-bg cursor-pointer hover:bg-brand-surface disabled:opacity-50"
												>{recomputingId === d.id ? 'Computing...' : 'Recompute'}</button>
											</ConfirmPopover>
											{#if sp}
												<ConfirmPopover message="Remove this derived parameter from the site?" confirmLabel="Remove" confirmVariant="alarm" onconfirm={() => unassignDerived(sp)}>
													<button class="px-2 py-1 text-xs text-severity-alarm cursor-pointer hover:underline ml-1">Remove</button>
												</ConfirmPopover>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					{:else if !showAssignDerived}
						<p class="text-sm text-brand-muted px-4 py-4">No derived parameters assigned.</p>
					{/if}
				</div>

		<!-- Sensors tab -->
		{:else if activeTab === 2}
			<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
				{#each deployedSensors as sensor}
					{@const dep = sensorDeployment(sensor.id)}
					{@const cal = sensorLatestCalibration(sensor.id)}
					{@const cals = sensorCalibrations(sensor.id)}
					<div class="rounded-md border border-brand-divider bg-brand-surface p-4">
						<div class="flex items-center justify-between mb-2">
							<a href="{base}/sensors/{sensor.id}" class="font-semibold text-sm text-brand-primary no-underline hover:underline">
								{sensor.name ?? sensor.serial_number ?? 'Sensor'}
							</a>
							<span class="text-xs text-brand-muted">{sensor.manufacturer} {sensor.model}</span>
						</div>
						<div class="text-xs text-brand-muted space-y-1">
							{#if sensor.serial_number}<div>S/N: <span class="font-mono">{sensor.serial_number}</span></div>{/if}
							{#if dep}<div>Deployed: {formatRelativeTime(dep.deployed_from)}</div>{/if}
							{#if cal}
								<div>
									Calibration: y = {cal.slope}x + {cal.intercept}
									<span class="text-brand-muted ml-1">({formatRelativeTime(cal.valid_from)})</span>
								</div>
							{/if}
						</div>

						<!-- Calibration timeline -->
						{#if cals.length > 0}
							<div class="mt-3 border-t border-brand-divider pt-2">
								<div class="text-xs font-semibold text-brand-muted mb-1.5">Calibration History</div>
								<div class="space-y-1">
									{#each cals as c}
										{@const active = isActiveCalibration(c)}
										<div class="flex items-center gap-2 text-xs {active ? 'bg-brand-primary/10 rounded px-1.5 py-1 -mx-1.5' : 'px-0 py-0.5'}">
											<span class="w-1.5 h-1.5 rounded-full shrink-0 {active ? 'bg-brand-primary' : 'bg-brand-divider'}"></span>
											<span class="font-mono text-brand-muted">{formatDateTime(c.valid_from)}</span>
											<span class="text-brand-muted">to</span>
											<span class="font-mono text-brand-muted">{c.valid_until ? formatDateTime(c.valid_until) : 'present'}</span>
											<span class="ml-auto font-mono">{c.slope}x + {c.intercept}</span>
											{#if active}<span class="text-brand-primary font-semibold ml-1">Active</span>{/if}
										</div>
									{/each}
								</div>
							</div>
						{/if}
					</div>
				{/each}
				{#if deployedSensors.length === 0}
					<p class="text-sm text-brand-muted col-span-full">No sensors currently deployed at this site</p>
				{/if}
			</div>

		<!-- Samples tab -->
		{:else if activeTab === 3}
			<div class="space-y-3">
				{#if samples.length === 0}
					<p class="text-sm text-brand-muted">No grab samples recorded for this site.</p>
				{:else}
					<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
						<table class="w-full text-sm">
							<thead><tr class="bg-brand-bg border-b border-brand-divider">
								<th class="text-left px-4 py-2 font-semibold">Time</th>
								<th class="text-left px-4 py-2 font-semibold">Parameter</th>
								<th class="text-left px-4 py-2 font-semibold">Label</th>
								<th class="text-right px-4 py-2 font-semibold">Mean</th>
								<th class="text-right px-4 py-2 font-semibold">Stdev</th>
								<th class="text-right px-4 py-2 font-semibold">N</th>
								<th class="text-right px-4 py-2 font-semibold">Min</th>
								<th class="text-right px-4 py-2 font-semibold">Max</th>
							</tr></thead>
							<tbody>
								{#each samples as s}
									<tr class="border-b border-brand-divider last:border-b-0">
										<td class="px-4 py-2 text-xs">{formatDateTime(s.collected_at)}</td>
										<td class="px-4 py-2">{paramName(s.parameter_id)}</td>
										<td class="px-4 py-2 text-brand-muted">{s.label ?? '—'}</td>
										<td class="px-4 py-2 text-right font-mono">{s.mean != null ? s.mean.toFixed(3) : '—'}</td>
										<td class="px-4 py-2 text-right font-mono">{s.stdev != null ? s.stdev.toFixed(3) : '—'}</td>
										<td class="px-4 py-2 text-right font-mono">{s.n}</td>
										<td class="px-4 py-2 text-right font-mono">{s.min_value != null ? s.min_value.toFixed(3) : '—'}</td>
										<td class="px-4 py-2 text-right font-mono">{s.max_value != null ? s.max_value.toFixed(3) : '—'}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>

		<!-- Status tab -->
		{:else if activeTab === 4}
			<div class="space-y-3">
				<div class="flex gap-1">
					{#each ['24h', '7d', '30d'] as range}
						<button
							onclick={() => { statusTimeRange = range as typeof statusTimeRange; loadStatusEvents(); }}
							class="px-3 py-1 text-xs rounded-md cursor-pointer border-none {statusTimeRange === range ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted'}"
						>{range}</button>
					{/each}
				</div>
				{#if statusLoading}
					<p class="text-sm text-brand-muted">Loading events...</p>
				{:else if statusEvents.length === 0}
					<p class="text-sm text-brand-muted">No status events. Click a time range to load.</p>
				{:else}
					<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
						<table class="w-full text-sm">
							<thead><tr class="bg-brand-bg border-b border-brand-divider">
								<th class="text-left px-4 py-2 font-semibold">Time</th>
								<th class="text-left px-4 py-2 font-semibold">Status</th>
							</tr></thead>
							<tbody>
								{#each statusEvents as evt}
									<tr class="border-b border-brand-divider last:border-b-0">
										<td class="px-4 py-2 text-xs">{formatDateTime(evt.time)}</td>
										<td class="px-4 py-2"><span class="px-2 py-0.5 text-xs rounded-full bg-brand-bg text-brand-muted">{evt.status}</span></td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>

		<!-- Notes tab -->
		{:else if activeTab === 5}
			<div class="space-y-3">
				<button onclick={() => addNoteOpen = true} class="px-3 py-1.5 bg-brand-primary text-white rounded-md text-sm cursor-pointer border-none">Add Note</button>
				{#each notes as note}
					<div class="rounded-md border border-brand-divider bg-brand-surface p-3">
						<div class="flex items-start justify-between">
							<p class="text-sm whitespace-pre-wrap">{note.text}</p>
							<ConfirmPopover message="Delete this note?" confirmLabel="Delete" onconfirm={() => deleteNote(note.id)}>
								<button class="text-xs text-severity-alarm bg-transparent border-none cursor-pointer hover:underline ml-2 shrink-0">Delete</button>
							</ConfirmPopover>
						</div>
						<div class="text-xs text-brand-muted mt-2">
							{note.author ?? 'Unknown'} · {formatRelativeTime(note.created_at)}
						</div>
					</div>
				{/each}
				{#if notes.length === 0}
					<p class="text-sm text-brand-muted">No notes yet.</p>
				{/if}
			</div>

		<!-- Scatter tab -->
		{:else if activeTab === 6}
			<div class="space-y-4">
				<div class="flex items-center gap-3 flex-wrap">
					<div>
						<label for="scatter-x-param" class="text-sm font-medium block mb-1">X Axis</label>
						<select id="scatter-x-param" bind:value={scatterXParamId} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm min-w-[180px]">
							<option value="">-- Select --</option>
							{#each measurementParams as sp}
								{@const param = parameters.find((p) => p.id === sp.parameter_id)}
								{#if param}
									<option value={sp.id} disabled={sp.id === scatterYParamId}>{param.display_name} ({sp.display_units ?? param.default_units})</option>
								{/if}
							{/each}
						</select>
					</div>
					<span class="text-sm text-brand-muted mt-5">vs</span>
					<div>
						<label for="scatter-y-param" class="text-sm font-medium block mb-1">Y Axis</label>
						<select id="scatter-y-param" bind:value={scatterYParamId} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm min-w-[180px]">
							<option value="">-- Select --</option>
							{#each measurementParams as sp}
								{@const param = parameters.find((p) => p.id === sp.parameter_id)}
								{#if param}
									<option value={sp.id} disabled={sp.id === scatterXParamId}>{param.display_name} ({sp.display_units ?? param.default_units})</option>
								{/if}
							{/each}
						</select>
					</div>
				</div>

				{#if scatterXParamId && scatterYParamId}
					{@const xSp = measurementParams.find((sp) => sp.id === scatterXParamId)}
					{@const ySp = measurementParams.find((sp) => sp.id === scatterYParamId)}
					{@const xParam = xSp ? parameters.find((p) => p.id === xSp.parameter_id) : null}
					{@const yParam = ySp ? parameters.find((p) => p.id === ySp.parameter_id) : null}
					{@const xChartData = chartDataMap.get(scatterXParamId)}
					{@const yChartData = chartDataMap.get(scatterYParamId)}
					{#if chartLoading}
						<div class="h-[400px] flex items-center justify-center text-sm text-brand-muted rounded-md border border-brand-divider bg-brand-surface">Loading chart data...</div>
					{:else if xChartData && yChartData && xParam && yParam && xSp && ySp}
						<div class="rounded-md border border-brand-divider bg-brand-surface p-4">
							<ScatterPlot
								xData={xChartData.values}
								yData={yChartData.values}
								xLabel={xParam.display_name}
								yLabel={yParam.display_name}
								xUnits={xSp.display_units ?? xParam.default_units}
								yUnits={ySp.display_units ?? yParam.default_units}
								times={xChartData.times}
							/>
						</div>
					{:else}
						<div class="h-[400px] flex items-center justify-center text-sm text-brand-muted rounded-md border border-brand-divider bg-brand-surface">No data available for the selected parameters</div>
					{/if}
				{:else}
					<div class="h-[400px] flex items-center justify-center text-sm text-brand-muted rounded-md border border-brand-divider bg-brand-surface">
						Select X and Y parameters to generate a scatter plot
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Add Note Dialog -->
	<Dialog bind:open={addNoteOpen} title="Add Note" maxWidth="sm">
		{#snippet children()}
			<textarea bind:value={newNoteText} rows="4" placeholder="Write a note..." class="w-full px-3 py-2 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"></textarea>
		{/snippet}
		{#snippet actions()}
			<button onclick={() => addNoteOpen = false} class="px-3 py-1.5 border border-brand-divider rounded-md text-sm cursor-pointer bg-brand-surface">Cancel</button>
			<button onclick={addNote} disabled={savingNote || !newNoteText.trim()} class="px-3 py-1.5 bg-brand-primary text-white rounded-md text-sm cursor-pointer border-none disabled:opacity-50">{savingNote ? 'Saving...' : 'Save'}</button>
		{/snippet}
	</Dialog>

	<!-- Export Dialog -->
	<Dialog bind:open={exportOpen} title="Export Data" maxWidth="sm">
		{#snippet children()}
			<div class="space-y-3">
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="exp-start" class="text-sm font-medium block mb-1">Start</label>
						<input id="exp-start" type="datetime-local" bind:value={exportStart} class="w-full px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-sm" />
					</div>
					<div>
						<label for="exp-end" class="text-sm font-medium block mb-1">End</label>
						<input id="exp-end" type="datetime-local" bind:value={exportEnd} class="w-full px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-sm" />
					</div>
				</div>
				<div>
					<label for="exp-res" class="text-sm font-medium block mb-1">Resolution</label>
					<select id="exp-res" bind:value={exportResolution} class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
						<option value="raw">Raw</option>
						<option value="hourly">Hourly</option>
						<option value="daily">Daily</option>
					</select>
				</div>
				<div>
					<label class="text-sm font-medium block mb-1">Format</label>
					<div class="flex gap-3">
						{#each [['csv', 'CSV'], ['json', 'JSON'], ['ndjson', 'NDJSON']] as [val, label]}
							<label class="flex items-center gap-1.5 cursor-pointer text-sm">
								<input type="radio" bind:group={exportFormat} value={val} /> {label}
							</label>
						{/each}
					</div>
				</div>
			</div>
		{/snippet}
		{#snippet actions()}
			<button onclick={() => exportOpen = false} class="px-3 py-1.5 border border-brand-divider rounded-md text-sm cursor-pointer bg-brand-surface">Cancel</button>
			<button onclick={handleExport} disabled={exportLoading} class="px-3 py-1.5 bg-brand-primary text-white rounded-md text-sm cursor-pointer border-none disabled:opacity-50">{exportLoading ? 'Exporting...' : 'Download'}</button>
		{/snippet}
	</Dialog>
{/if}
