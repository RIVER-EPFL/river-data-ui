<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { api, type Site, type Project, type SiteParameter, type Parameter, type Sensor, type SensorDeployment, type SensorCalibration, type Note, type AlarmThreshold, type DerivedParameter, type Sample, type Annotation, type Subproject } from '$api/crud';
	import { GET, POST, PATCH } from '$api/client';
	import { recomputeDerived, getThresholds, getActiveAlarms, type ResolvedThreshold, type ActiveAlarm } from '$api/service';
	import { getSiteSensorIdentity, type SensorIdentityResponse } from '$api/sensors';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { siteNavigator } from '$lib/stores/sites.svelte';
	import { formatRelativeTime, formatDateTime, formatDate, toDatetimeLocal, fromDatetimeLocal } from '$lib/utils';
	import { timezoneStore } from '$lib/stores/timezone.svelte';
	import Button from '$components/ui/Button.svelte';
	import Tabs from '$components/ui/Tabs.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import PaginationControls from '$components/ui/PaginationControls.svelte';
	import Breadcrumbs from '$components/ui/Breadcrumbs.svelte';
	import ThresholdDialog from '$components/dialogs/ThresholdDialog.svelte';
	import DeployMoveSensorDialog from '$components/dialogs/DeployMoveSensorDialog.svelte';
	import MergeSiteParameterDialog from '$components/dialogs/MergeSiteParameterDialog.svelte';
	import ParameterChart, { type ChartData } from '$components/charts/ParameterChart.svelte';
	import { GAP_THRESHOLDS } from '$lib/charts/uPlotTheme';
	import { autoResolution, type Frequency } from '$lib/charts/multiSiteSeries';
	import type { SpotPointStats } from '$lib/charts/spotMarkers';
	import FrequencyChips from '$components/charts/FrequencyChips.svelte';
	import SharedChartTooltip from '$components/charts/SharedChartTooltip.svelte';
	import TimeRangeSlider from '$components/charts/TimeRangeSlider.svelte';
	import ResolutionChips from '$components/charts/ResolutionChips.svelte';
	import type { StatusEventsResponse } from '$lib/api/types';
	import { eventBus } from '$lib/stores/events.svelte';
	import { formatThresholdRange } from '$lib/alarms';
	import { me } from '$auth/me.svelte';

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
	// Tabs are dispatched by a stable key, not a hardcoded index, so the admin-only Status tab can be
	// conditionally present without the body blocks below falling out of sync.
	const tabDefs = $derived([
		{ key: 'charts', label: 'Charts' },
		{ key: 'parameters', label: 'Parameters' },
		{ key: 'sensors', label: 'Sensors' },
		{ key: 'samples', label: 'Samples' },
		...(me.can('admin') ? [{ key: 'status', label: 'Status' }] : []),
		{ key: 'notes', label: 'Notes' },
	]);
	const tabLabels = $derived(tabDefs.map((t) => t.label));
	const activeKey = $derived(tabDefs[activeTab]?.key ?? 'charts');
	let statsOpen = $state(false);
	let recomputingId = $state<string | null>(null);
	let confirmingRemove = $state<string | null>(null);

	// Inline subproject move: the picker lists every subproject (Project — Subproject), so a site can
	// be moved across projects too; the DB trigger re-syncs project_id from the chosen subproject.
	let subprojectPicker = $state<{ options: Array<{ value: string; label: string }>; names: Map<string, string> } | null>(null);
	let editingSubproject = $state(false);
	let pendingSubprojectId = $state('');
	let savingSubproject = $state(false);

	let currentSubprojectName = $state<string | null>(null);
	$effect(() => {
		const id = site?.subproject_id;
		if (!id) {
			currentSubprojectName = null;
			return;
		}
		api.subprojects
			.get(id)
			.then((s) => (currentSubprojectName = s.name))
			.catch(() => (currentSubprojectName = null));
	});

	async function openSubprojectPicker() {
		if (!subprojectPicker) {
			const [subs, projs] = await Promise.all([
				api.subprojects.list({ perPage: 1000, sort: ['name', 'ASC'] }),
				api.projects.list({ perPage: 100 }),
			]);
			const projectNames = new Map(projs.data.map((p) => [p.id, p.name]));
			subprojectPicker = {
				options: subs.data.map((s: Subproject) => ({
					value: s.id,
					label: `${projectNames.get(s.project_id) ?? '—'} — ${s.name}`,
				})),
				names: new Map(subs.data.map((s: Subproject) => [s.id, s.name])),
			};
		}
		pendingSubprojectId = site?.subproject_id ?? '';
		editingSubproject = true;
	}

	async function saveSubproject() {
		if (!site || !pendingSubprojectId || pendingSubprojectId === site.subproject_id) {
			editingSubproject = false;
			return;
		}
		savingSubproject = true;
		try {
			const updated = await api.sites.update(site.id, { subproject_id: pendingSubprojectId });
			site = updated;
			if (project?.id !== updated.project_id) project = await api.projects.get(updated.project_id);
			editingSubproject = false;
			toastStore.success('Site moved');
			void siteNavigator.refresh();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to move site');
		} finally {
			savingSubproject = false;
		}
	}

	let autoUpdate = $state(typeof localStorage !== 'undefined' && localStorage.getItem('river-data-auto-update') !== 'false');
	let newDataAvailable = $state(false);

	function toggleAutoUpdate() {
		autoUpdate = !autoUpdate;
		localStorage.setItem('river-data-auto-update', String(autoUpdate));
		if (autoUpdate && newDataAvailable) {
			newDataAvailable = false;
			scheduleFetch();
		}
	}

	// Threshold editor state
	let thresholdDialogOpen = $state(false);
	let thresholdEditingParamId = $state('');
	let thresholdEditingParamName = $state('');

	function openThresholdDialog(parameterId: string, parameterName: string) {
		thresholdEditingParamId = parameterId;
		thresholdEditingParamName = parameterName;
		thresholdDialogOpen = true;
	}

	async function reloadThresholds() {
		if (!site) return;
		// Raw rows for the editor's override/reset lookups; resolved map for what actually applies.
		const [th, resolved] = await Promise.all([
			api.alarmThresholds.list({ perPage: 200 }),
			getThresholds({ site_id: site.id }),
		]);
		thresholds = th.data;
		resolvedThresholds = new Map(resolved.map((r) => [r.parameter_id, r]));
	}

	function isThresholdDisabled(th: AlarmThreshold): boolean {
		return th.warning_min == null && th.warning_max == null && th.alarm_min == null && th.alarm_max == null;
	}

	async function disableAlarms(parameterId: string) {
		if (!site) return;
		try {
			const existing = thresholds.find((t) => t.parameter_id === parameterId && t.site_id === site!.id);
			const payload = { site_id: site.id, parameter_id: parameterId, warning_min: null, warning_max: null, alarm_min: null, alarm_max: null };
			if (existing) {
				await api.alarmThresholds.update(existing.id, payload);
			} else {
				await api.alarmThresholds.create(payload);
			}
			toastStore.success('Alarms disabled');
			await reloadThresholds();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to disable alarms');
		}
	}

	// Effective thresholds come from the backend's single resolver (GET /api/alarms/thresholds). The
	// UI no longer re-implements the 3-tier resolution. Keyed by parameter_id (this page is one site).
	// `thresholds` (raw rows) is still loaded for the editor's override/reset lookups.
	let resolvedThresholds = $state<Map<string, ResolvedThreshold>>(new Map());

	function effectiveThreshold(parameterId: string): AlarmThreshold | undefined {
		const r = resolvedThresholds.get(parameterId);
		if (!r) return undefined;
		return {
			id: '',
			parameter_id: parameterId,
			site_id: r.source === 'site' ? (site?.id ?? null) : null,
			warning_min: r.warning_min,
			warning_max: r.warning_max,
			alarm_min: r.alarm_min,
			alarm_max: r.alarm_max,
			created_at: '',
			updated_at: '',
		};
	}

	// Shared chart state
	const cursorSyncKey = 'site-charts';
	let resolutionOverride = $state<'auto' | 'raw' | 'hourly' | 'daily'>('auto');
	// Frequency selects which readings drive the charts, by measurement_type:
	//   high = continuous field-sensor line (default), low = discrete spot/grab markers, all = both.
	let frequency = $state<Frequency>('high');

	let sliderMax = $state(Date.now());
	let sliderMin = $state(Date.now() - 90 * 86400000);
	let chartStart = $state(Date.now() - 604800000);
	let chartEnd = $state(Date.now());

	interface SiteDetailParameter {
		id: string;
		code?: string;
		name?: string;
		units?: string | null;
		is_derived?: boolean;
		sensor_type?: string | null;
		data_start?: string | null;
		data_end?: string | null;
		reading_count?: number | null;
		has_continuous?: boolean;
		has_spot?: boolean;
		frequency?: 'high' | 'low' | 'mixed';
	}
	interface SiteDetailResponse {
		data_start: string | null;
		data_end: string | null;
		reading_count: number;
		parameters: SiteDetailParameter[];
	}

	let paramExtents = $state<Map<string, SiteDetailParameter>>(new Map());

	let sliderRef: TimeRangeSlider | undefined = $state();

	const chartResolution = $derived<'raw' | 'hourly' | 'daily'>(
		resolutionOverride === 'auto' ? autoResolution(chartStart, chartEnd) : resolutionOverride
	);

	const gapThreshold = $derived(GAP_THRESHOLDS[chartResolution] ?? 0);

	const windowDuration = $derived((chartEnd - chartStart) / 86400000);
	const windowLabel = $derived.by(() => {
		const days = windowDuration;
		if (days < 1) return `${Math.round(days * 24)}h`;
		if (days < 60) return `${Math.round(days)}d`;
		return `${(days / 30).toFixed(1)}mo`;
	});

	// Shared data fetch - one request for all charts
	interface ReadingsResponse {
		times: string[];
		parameters: Array<{ id: string; name: string; units: string | null; values: (number | null)[]; flagged?: (boolean | null)[] | null; flag_reasons?: (string | null)[] | null }>;
	}
	interface AggregatesResponse {
		times: string[];
		parameters: Array<{ id: string; name: string; units: string | null; avg: (number | null)[]; min: (number | null)[]; max: (number | null)[]; count: number[]; flagged_count?: number[] }>;
	}

	let chartLoading = $state(false);
	let chartDataMap = $state<Map<string, ChartData>>(new Map());
	// Spot/grab samples per site_parameter id, drawn as discrete markers (Low/All frequency).
	let spotDataMap = $state<Map<string, ChartData>>(new Map());
	// Replicate mean±sd whisker stats per global parameter_id, keyed by epoch ms of collected_at.
	let spotStatsMap = $state<Map<string, Map<number, SpotPointStats>>>(new Map());
	let annotationsByParam = $state<Map<string, Annotation[]>>(new Map());
	let showSensorVectors = $state(false);
	let showCalibrationMarkers = $state(false);
	let showAlarmBands = $state(true);
	let sensorIdentity = $state<SensorIdentityResponse | null>(null);
	let fetchGeneration = 0;
	let fetchTimer: ReturnType<typeof setTimeout> | null = null;

	function scheduleFetch() {
		if (fetchTimer) clearTimeout(fetchTimer);
		fetchTimer = setTimeout(() => { fetchTimer = null; doFetch(); }, 50);
	}

	function scrollToParameter(parameterId: string) {
		// Deep link from the alarm Event Log: bring the focused parameter's chart into view once charts mount.
		setTimeout(() => {
			document.getElementById(`param-${parameterId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}, 450);
	}

	$effect(() => {
		// Touch toggles so flipping them triggers a refetch (identity is window-scoped).
		void showSensorVectors; void showCalibrationMarkers; void frequency;
		if (site) scheduleFetch();
	});

	async function doFetch() {
		chartLoading = true;
		const gen = ++fetchGeneration;
		const startDate = new Date(chartStart).toISOString();
		const endDate = new Date(chartEnd).toISOString();

		try {
			const res = chartResolution;
			const map = new Map<string, ChartData>();

			// high/all draw the continuous line; low/all draw the spot markers. Both fetches are
			// issued from this one debounced+generation-guarded call so they can't race each other.
			const wantContinuous = frequency === 'high' || frequency === 'all';
			const wantSpot = frequency === 'low' || frequency === 'all';

			const dataPromise = !wantContinuous
				? Promise.resolve(null)
				: res === 'raw'
					// RAW readings must be filtered to continuous only; the spot samples come from the
					// separate spot fetch. (Aggregates are already continuous-only by design.)
					? GET<ReadingsResponse>(`/api/sites/${siteId}/readings`, { start: startDate, end: endDate, measurement_type: 'continuous' })
					: GET<AggregatesResponse>(`/api/sites/${siteId}/aggregates/${res}`, { start: startDate, end: endDate });
			const spotPromise = wantSpot
				? GET<ReadingsResponse>(`/api/sites/${siteId}/readings`, { start: startDate, end: endDate, measurement_type: 'spot' }).catch(() => null)
				: Promise.resolve(null);
			// Replicate stats for whiskers on the spot diamonds (small table; filtered client-side).
			const samplesPromise = wantSpot
				? api.samples.list({ perPage: 1000, filter: { site_id: siteId }, sort: ['collected_at', 'ASC'] }).catch(() => null)
				: Promise.resolve(null);
			const annotationsPromise = GET<Annotation[]>(`/api/sites/${siteId}/annotations`, { start: startDate, end: endDate })
				.catch(() => [] as Annotation[]);
			const identityPromise = (showSensorVectors || showCalibrationMarkers)
				? getSiteSensorIdentity(siteId, { start: startDate, end: endDate }).catch(() => null)
				: Promise.resolve(null);

			const [result, spotResult, samplesResult, anns, identity] = await Promise.all([dataPromise, spotPromise, samplesPromise, annotationsPromise, identityPromise]);
			if (gen === fetchGeneration) sensorIdentity = identity;
			if (gen !== fetchGeneration) return;

			if (result && result.times?.length) {
				const parsedTimes = result.times.map((t) => new Date(t).getTime() / 1000);
				if (res === 'raw') {
					for (const p of (result as ReadingsResponse).parameters ?? []) {
						map.set(p.id, { times: parsedTimes, values: p.values, flags: p.flagged ?? null, flagReasons: p.flag_reasons ?? null });
					}
				} else {
					for (const p of (result as AggregatesResponse).parameters ?? []) {
						const flags = p.flagged_count ? p.flagged_count.map((n) => n > 0) : null;
						map.set(p.id, { times: parsedTimes, values: p.avg, mins: p.min, maxs: p.max, flags });
					}
				}
			}
			chartDataMap = map;

			const smap = new Map<string, ChartData>();
			if (spotResult && spotResult.times?.length) {
				const spotTimes = spotResult.times.map((t) => new Date(t).getTime() / 1000);
				for (const p of spotResult.parameters ?? []) {
					smap.set(p.id, { times: spotTimes, values: p.values, flags: p.flagged ?? null, flagReasons: p.flag_reasons ?? null });
				}
			}
			spotDataMap = smap;

			const statsMap = new Map<string, Map<number, SpotPointStats>>();
			if (samplesResult) {
				const winStart = new Date(startDate).getTime();
				const winEnd = new Date(endDate).getTime();
				for (const s of samplesResult.data) {
					if (s.mean == null) continue;
					const t = new Date(s.collected_at).getTime();
					if (t < winStart || t > winEnd) continue;
					const inner = statsMap.get(s.parameter_id) ?? new Map<number, SpotPointStats>();
					inner.set(t, { mean: s.mean, stdev: s.stdev, n: s.n });
					statsMap.set(s.parameter_id, inner);
				}
			}
			spotStatsMap = statsMap;

			const annMap = new Map<string, Annotation[]>();
			for (const a of anns) {
				const list = annMap.get(a.parameter_id) ?? [];
				list.push(a);
				annMap.set(a.parameter_id, list);
			}
			annotationsByParam = annMap;
		} catch (e) {
			if (gen === fetchGeneration) {
				toastStore.error('Failed to load chart data');
				chartDataMap = new Map();
				spotDataMap = new Map();
				annotationsByParam = new Map();
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
	let exportStartMs = $state(Date.now() - 7 * 86400000);
	let exportEndMs = $state(Date.now());
	let exportFormat = $state<'csv' | 'json' | 'ndjson'>('csv');
	let exportResolution = $state<'raw' | 'hourly' | 'daily'>('hourly');
	let exportLoading = $state(false);
	let exportSelectedParamIds = $state<string[]>([]);
	let exportIncludeFlagged = $state(true);
	let exportIncludeReplicates = $state(false);
	let exportMeasurementType = $state<'all' | 'continuous' | 'spot' | 'derived'>('all');

	const exportStartStr = $derived(exportStartMs ? toDatetimeLocal(exportStartMs, timezoneStore.zone) : '');
	const exportEndStr = $derived(exportEndMs ? toDatetimeLocal(exportEndMs, timezoneStore.zone) : '');

	function onExportStartInput(e: Event) {
		const val = (e.target as HTMLInputElement).value;
		if (val) exportStartMs = new Date(fromDatetimeLocal(val, timezoneStore.zone)).getTime();
	}
	function onExportEndInput(e: Event) {
		const val = (e.target as HTMLInputElement).value;
		if (val) exportEndMs = new Date(fromDatetimeLocal(val, timezoneStore.zone)).getTime();
	}

	// Status events
	const STATUS_PAGE_SIZE = 50;
	let statusEvents = $state<StatusEventsResponse['events']>([]);
	let statusTimeRange = $state<'24h' | '7d' | '30d'>('24h');
	let statusLoading = $state(false);
	let statusLoaded = $state(false);
	let statusOffset = $state(0);
	let statusTotal = $state(0);
	const statusPage = $derived(Math.floor(statusOffset / STATUS_PAGE_SIZE) + 1);

	$effect(() => {
		if (activeKey === 'status' && site && !statusLoaded) {
			statusLoaded = true;
			loadStatusEvents();
		}
	});

	const siteId = $derived(page.params.id!);

	// Live active warnings/alarms for this site, keyed by parameter so each ParameterChart shows its
	// own "active for ..." badge in its header. `now` ticks so the duration stays fresh without refetching.
	let activeBreaches = $state<ActiveAlarm[]>([]);
	let now = $state(Date.now());
	const activeBreachByParam = $derived(new Map(activeBreaches.map((a) => [a.parameter_id, a])));

	async function loadActiveBreaches() {
		try {
			const result = await getActiveAlarms();
			activeBreaches = result.alarms.filter((a) => a.site_id === siteId);
		} catch {
			/* best-effort */
		}
	}

	let unsubEvents: (() => void) | null = null;
	let nowTimer: ReturnType<typeof setInterval> | null = null;

	async function loadSite() {
		const id = siteId;
		loading = true;
		error = null;
		// Clear per-site state so the previous site's data can't linger while the new one loads.
		site = null;
		statusLoaded = false;
		statusOffset = 0;
		newDataAvailable = false;

		const deepStart = page.url.searchParams.get('start');
		const deepEnd = page.url.searchParams.get('end');
		const focusParam = page.url.searchParams.get('focus');
		let deepLink = false;
		if (deepStart && deepEnd) {
			const ds = new Date(deepStart).getTime();
			const de = new Date(deepEnd).getTime();
			if (!Number.isNaN(ds) && !Number.isNaN(de) && de > ds) {
				chartStart = ds;
				chartEnd = de;
				deepLink = true;
			}
		}
		try {
			const s = await api.sites.get(id);
			site = s;

			const [proj, sp, params, sens, deps, cals, n, th] = await Promise.all([
				api.projects.get(s.project_id),
				api.siteParameters.list({ perPage: 100, filter: { site_id: id } }),
				api.parameters.list({ perPage: 500 }),
				api.sensors.list({ perPage: 200 }),
				api.sensorDeployments.list({ perPage: 200, filter: { site_id: id } }),
				api.sensorCalibrations.list({ perPage: 500 }),
				api.notes.list({ perPage: 50, filter: { site_id: id }, sort: ['created_at', 'DESC'] }),
				api.alarmThresholds.list({ perPage: 200 }),
			]);
			project = proj;
			siteParameters = sp.data;
			parameters = params.data;
			sensors = sens.data;
			deployments = deps.data;
			calibrations = cals.data;
			notes = n.data;
			thresholds = th.data;
			resolvedThresholds = new Map(
				(await getThresholds({ site_id: id })).map((r) => [r.parameter_id, r]),
			);

			// Bound the slider to the site's actual data extent
			try {
				const detailRes = await GET<SiteDetailResponse>(`/api/sites/${id}/detail`);
				if (detailRes.data_start) sliderMin = new Date(detailRes.data_start).getTime();
				if (detailRes.data_end) sliderMax = new Date(detailRes.data_end).getTime();
				// Default the frequency chip from the data: a spot-only site opens on Low (its
				// points would otherwise be invisible behind the High default); any spot data at
				// all opens on All so nothing is hidden.
				{
					const withData = detailRes.parameters.filter((p) => (p.reading_count ?? 0) > 0);
					if (withData.length > 0 && withData.every((p) => p.frequency === 'low')) {
						frequency = 'low';
					} else if (withData.some((p) => p.has_spot)) {
						frequency = 'all';
					}
				}
				if (deepLink) {
					// Pinned window from a deep link: widen the slider bounds to fit it.
					sliderMin = Math.min(sliderMin, chartStart);
					sliderMax = Math.max(sliderMax, chartEnd);
				} else {
					if (chartStart < sliderMin) chartStart = sliderMin;
					if (chartEnd > sliderMax) chartEnd = sliderMax;
					if (chartStart >= chartEnd) {
						// Data ended before the default now-anchored window: show its last week instead.
						chartStart = Math.max(sliderMin, chartEnd - 604800000);
					}
				}
				exportStartMs = sliderMin;
				exportEndMs = sliderMax;
				const extents = new Map<string, SiteDetailParameter>();
				for (const p of detailRes.parameters ?? []) extents.set(p.id, p);
				paramExtents = extents;
			} catch { /* non-critical */ }

			scheduleFetch();

			if (focusParam) scrollToParameter(focusParam);

			loadActiveBreaches();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load site';
		} finally { loading = false; }

		try {
			const [derivedResult, samplesResult] = await Promise.all([
				api.derivedParameters.list({ perPage: 200 }),
				api.samples.list({ perPage: 200, filter: { site_id: id }, sort: ['collected_at', 'DESC'] }),
			]);
			derivedDefs = derivedResult.data;
			samples = samplesResult.data;
		} catch (e) {
			toastStore.error(e instanceof Error ? `Failed to load derived parameters / samples: ${e.message}` : 'Failed to load derived parameters / samples');
		}
	}

	// (Re)load whenever the site id or deep-link window changes. SvelteKit reuses this component when
	// navigating between two /sites/[id] pages, so onMount fires only once. Without this, clicking an
	// alarm for a different site (e.g. from the notification bell) would change the URL but not the page.
	let loadedKey = '';
	$effect(() => {
		const key = `${siteId}|${page.url.search}`;
		if (key === loadedKey) return;
		loadedKey = key;
		untrack(() => {
			loadSite();
		});
	});

	onMount(() => {
		nowTimer = setInterval(() => { now = Date.now(); }, 30_000);
		unsubEvents = eventBus.subscribe('data_ingested', (event: any) => {
			if (!site) return;
			if (event.site_id === site.id) {
				loadActiveBreaches();
				if (autoUpdate) {
					const wasAtMax = Math.abs(chartEnd - sliderMax) < 60000;
					sliderMax = Date.now();
					if (wasAtMax) chartEnd = sliderMax;
					scheduleFetch();
				} else {
					newDataAvailable = true;
				}
			}
		});
	});

	onDestroy(() => {
		unsubEvents?.();
		if (nowTimer) clearInterval(nowTimer);
	});

	function paramName(paramId: string): string { return parameters.find((p) => p.id === paramId)?.name ?? 'None'; }
	function paramCode(paramId: string): string { return parameters.find((p) => p.id === paramId)?.code ?? ''; }
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

	// Deploy / move / recall sensors at this site
	let deployHereOpen = $state(false);
	let moveOpen = $state(false);
	let moveSensor = $state<Sensor | null>(null);

	async function reloadDeployments() {
		const deps = await api.sensorDeployments.list({ perPage: 200, filter: { site_id: siteId } });
		deployments = deps.data;
	}

	async function handleRecallDeployment(sId: string) {
		const dep = sensorDeployment(sId);
		if (!dep) return;
		try {
			await api.sensorDeployments.update(dep.id, { deployed_until: new Date().toISOString() });
			toastStore.success('Sensor recalled - readings will be re-coordinated in the background');
			await reloadDeployments();
		} catch (e) { toastStore.error(e instanceof Error ? e.message : 'Recall failed'); }
	}

	// Merge site parameters (same site)
	let mergeOpen = $state(false);
	let mergeSource = $state<{ id: string; label: string } | null>(null);

	function openMergeSiteParameter(sp: SiteParameter) {
		mergeSource = { id: sp.id, label: paramName(sp.parameter_id) };
		mergeOpen = true;
	}

	async function reloadSiteParameters() {
		const sp = await api.siteParameters.list({ perPage: 200, filter: { site_id: siteId } });
		siteParameters = sp.data;
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
			const result = await GET<StatusEventsResponse>(
				`/api/sites/${siteId}/status_events`,
				{ start, limit: STATUS_PAGE_SIZE, offset: statusOffset, order: 'desc' }
			);
			statusEvents = result.events ?? [];
			statusTotal = result.total ?? 0;
		} catch (e) {
			statusEvents = [];
			statusTotal = 0;
			toastStore.error(e instanceof Error ? `Failed to load status events: ${e.message}` : 'Failed to load status events');
		}
		finally { statusLoading = false; }
	}

	function statusEventParamName(parameterId: string): string {
		return parameters.find((p) => p.id === parameterId)?.name ?? parameterId;
	}

	// Export
	async function handleExport() {
		if (!exportStartMs || !exportEndMs) return;
		exportLoading = true;
		try {
			const params = new URLSearchParams({
				start: new Date(exportStartMs).toISOString(),
				end: new Date(exportEndMs).toISOString(),
				format: exportFormat,
			});
			if (exportSelectedParamIds.length > 0) {
				params.set('parameter_ids', exportSelectedParamIds.join(','));
			}
			if (exportResolution === 'raw') {
				params.set('include_flagged', String(exportIncludeFlagged));
				params.set('include_replicates', String(exportIncludeReplicates));
				if (exportMeasurementType !== 'all') {
					params.set('measurement_type', exportMeasurementType);
				}
			}
			const path = exportResolution === 'raw'
				? `/api/sites/${siteId}/readings`
				: `/api/sites/${siteId}/aggregates/${exportResolution}`;
			const url = `${path}?${params.toString()}`;

			const { auth } = await import('$auth/keycloak.svelte');
			await auth.ensureToken();
			const response = await fetch(url, {
				headers: auth.token ? { Authorization: `Bearer ${auth.token}` } : undefined,
			});
			if (!response.ok) {
				const detail = await response.text().catch(() => response.statusText);
				throw new Error(`${response.status}: ${detail.slice(0, 200)}`);
			}
			const blob = await response.blob();
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = `${site?.name ?? 'export'}_${exportResolution}.${exportFormat === 'ndjson' ? 'ndjson' : exportFormat}`;
			a.click();
			URL.revokeObjectURL(a.href);
			toastStore.success('Export downloaded');
			exportOpen = false;
		} catch (e) { toastStore.error(e instanceof Error ? `Export failed: ${e.message}` : 'Export failed'); }
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

	let showAddParameter = $state(false);
	let addParamId = $state('');
	let addingParam = $state(false);

	const unassignedParameters = $derived(
		parameters.filter((p) => p.category === 'measurement' && !siteParameterIds.has(p.id))
	);

	async function addParameter() {
		if (!addParamId) return;
		addingParam = true;
		try {
			await api.siteParameters.create({ site_id: siteId, parameter_id: addParamId });
			const sp = await api.siteParameters.list({ perPage: 200, filter: { site_id: siteId } });
			siteParameters = sp.data;
			addParamId = '';
			showAddParameter = false;
			toastStore.success('Parameter added');
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to add parameter');
		} finally { addingParam = false; }
	}

	async function removeParameter(spId: string) {
		try {
			await api.siteParameters.remove(spId);
			const sp = await api.siteParameters.list({ perPage: 200, filter: { site_id: siteId } });
			siteParameters = sp.data;
			toastStore.success('Parameter removed');
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to remove parameter');
		}
	}

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
			toastStore.error('No output parameter - recompute the definition first');
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
				is_active: true,
			});
			toastStore.success(`${def.name || def.code} assigned`);
			const sp = await api.siteParameters.list({ perPage: 200, filter: { site_id: siteId } });
			siteParameters = sp.data;
			showAssignDerived = false;
			await recomputeDerived(def.id);
			toastStore.success('Recomputation triggered - chart will update as data fills');
			pollForDerivedData(def.output_parameter_id);
		} catch (e) {
			toastStore.error(`Failed: ${e instanceof Error ? e.message : 'unknown error'}`);
		} finally {
			assigningId = null;
		}
	}

	async function pollForDerivedData(outputParameterId: string, attempts = 12, intervalMs = 5000) {
		for (let i = 0; i < attempts; i++) {
			await new Promise((r) => setTimeout(r, intervalMs));
			await doFetch();
			const sp = siteParameters.find((s) => s.parameter_id === outputParameterId);
			if (sp) {
				const data = chartDataMap.get(sp.id);
				if (data && data.values.some((v) => v != null)) return;
			}
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
		return val != null ? val.toFixed(decimals) : 'None';
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
				name: param.name,
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

	let expandedSensors = $state(new Set<string>());
	function toggleSensorExpanded(id: string) {
		const next = new Set(expandedSensors);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		expandedSensors = next;
	}

	let showDiagnostics = $state(false);

	function hasData(sp: SiteParameter): boolean {
		const extent = paramExtents.get(sp.id);
		if (!extent) return true;
		if (typeof extent.reading_count === 'number') return extent.reading_count > 0;
		if (extent.data_start !== undefined) return extent.data_start !== null;
		return true;
	}

	// Measurement params for charts (exclude device_health, only those with data)
	const measurementParams = $derived(
		siteParameters.filter((sp) => {
			const param = parameters.find((p) => p.id === sp.parameter_id);
			return param && param.category !== 'device_health' && hasData(sp);
		})
	);

	// Diagnostic (device_health) params, only those with data
	const diagnosticParams = $derived(
		siteParameters.filter((sp) => {
			const param = parameters.find((p) => p.id === sp.parameter_id);
			return param && param.category === 'device_health' && hasData(sp);
		})
	);
</script>

<svelte:head><title>{site?.name ?? 'Site'} | River Data</title></svelte:head>

{#if loading}
	<p class="text-brand-muted">Loading site…</p>
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
				<Breadcrumbs items={[
					{ label: 'Sites', href: `${base}/sites` },
					...(project ? [{ label: project.name, href: `${base}/projects/${project.id}` }] : []),
				]} />
				<h2 class="text-xl font-semibold">
					{site.name}
					{#if site.public_code && project?.public_code}
						<a
							href="/api/public/{project.public_code}/sites/{site.public_code}"
							target="_blank"
							class="ml-2 px-2 py-0.5 text-xs font-medium rounded-full bg-severity-ok-soft text-severity-ok no-underline hover:underline"
							title="View in public API"
						>Public ↗</a>
					{/if}
				</h2>
				{#if site.description}<p class="text-sm text-brand-muted mt-1">{site.description}</p>{/if}
				{#if site.latitude && site.longitude}
					<p class="text-xs font-mono text-brand-muted mt-1">{site.latitude.toFixed(6)}, {site.longitude.toFixed(6)} {site.altitude_m ? `· ${site.altitude_m}m` : ''}</p>
				{/if}
				<div class="flex items-center gap-2 mt-1 text-xs text-brand-muted">
					<span>Subproject:</span>
					{#if editingSubproject && subprojectPicker}
						<select
							bind:value={pendingSubprojectId}
							class="px-2 py-1 text-xs border border-brand-divider rounded bg-brand-surface"
						>
							{#each subprojectPicker.options as opt (opt.value)}
								<option value={opt.value}>{opt.label}</option>
							{/each}
						</select>
						<button onclick={saveSubproject} disabled={savingSubproject} class="text-brand-primary cursor-pointer hover:underline disabled:opacity-50">{savingSubproject ? 'Moving…' : 'Save'}</button>
						<button onclick={() => (editingSubproject = false)} class="cursor-pointer hover:underline">Cancel</button>
					{:else}
						<span class="text-brand-text">{currentSubprojectName ?? '—'}</span>
						<button onclick={openSubprojectPicker} class="text-brand-primary cursor-pointer hover:underline" title="Move this site to another subproject (or project)">Change</button>
					{/if}
				</div>
			</div>
			<div class="flex gap-2">
				<Button onclick={() => exportOpen = true}>Export</Button>
				<a href="{base}/sites/{site.id}/import" class="px-3 py-1.5 border border-brand-divider bg-brand-surface text-sm rounded-md no-underline text-brand-text hover:bg-brand-bg">Import CSV</a>
				<a href="{base}/sites/{site.id}/edit" class="px-3 py-1.5 border border-brand-divider bg-brand-surface text-sm rounded-md no-underline text-brand-text hover:bg-brand-bg">Edit</a>
			</div>
		</div>

		<Tabs tabs={tabLabels} bind:active={activeTab} />

		<!-- Charts tab -->
		{#if activeKey === 'charts'}
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
						<ResolutionChips bind:value={resolutionOverride} effective={chartResolution} onchange={scheduleFetch} />

						<div class="w-px h-5 bg-brand-divider mx-1"></div>

						<span class="text-xs text-brand-muted font-semibold uppercase tracking-wider" title="High = continuous field-sensor line · Low = grab/spot samples · All = both">Frequency</span>
						<FrequencyChips bind:value={frequency} />

						{#if diagnosticParams.length > 0}
							<div class="w-px h-5 bg-brand-divider mx-1"></div>
							<label class="flex items-center gap-1.5 cursor-pointer text-xs text-brand-muted">
								<input type="checkbox" bind:checked={showDiagnostics} />
								Show diagnostics
							</label>
						{/if}

						<div class="w-px h-5 bg-brand-divider mx-1"></div>
						<label class="flex items-center gap-1.5 cursor-pointer text-xs text-brand-muted" title="Shade the periods a reading was in warning or alarm">
							<input type="checkbox" bind:checked={showAlarmBands} /> Alarm bands
						</label>
						<label class="flex items-center gap-1.5 cursor-pointer text-xs text-brand-muted" title="Colour the time axis by which sensor was deployed">
							<input type="checkbox" bind:checked={showSensorVectors} /> Sensor bands
						</label>
						<label class="flex items-center gap-1.5 cursor-pointer text-xs text-brand-muted" title="Mark calibration changes">
							<input type="checkbox" bind:checked={showCalibrationMarkers} /> Calibration markers
						</label>

						<div class="w-px h-5 bg-brand-divider mx-1"></div>
						<button
							onclick={toggleAutoUpdate}
							class="flex items-center gap-1.5 px-2 py-1 text-xs rounded-md cursor-pointer border-none {autoUpdate ? 'bg-severity-ok-soft text-severity-ok' : 'bg-brand-bg text-brand-muted'}"
							title={autoUpdate ? 'Auto-update: ON' : 'Auto-update: OFF'}
						>
							<span class="w-1.5 h-1.5 rounded-full {autoUpdate ? 'bg-severity-ok' : 'bg-brand-muted'}"></span>
							Live
						</button>

						<span class="text-xs text-brand-muted ml-auto font-mono">
							{windowLabel} · {formatDate(new Date(chartStart))} - {formatDate(new Date(chartEnd))}
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

				<!-- New data banner -->
				{#if newDataAvailable}
					<div class="flex items-center gap-2 px-3 py-2 text-sm bg-brand-primary/5 text-brand-primary rounded-md border border-brand-primary/20">
						<span>New data available</span>
						<Button
							variant="primary"
							size="sm"
							onclick={() => { newDataAvailable = false; scheduleFetch(); }}
						>Refresh</Button>
					</div>
				{/if}

				<!-- Charts -->
				{#each measurementParams as sp, i}
					{@const param = parameters.find((p) => p.id === sp.parameter_id)}
					{@const th = effectiveThreshold(sp.parameter_id)}
					{#if param}
						<div id="param-{sp.parameter_id}" class="scroll-mt-24"></div>
						<ParameterChart
							siteId={siteId}
							siteParameterId={sp.id}
							parameterId={sp.parameter_id}
							parameterName={param.name}
							parameterCode={param.code}
							units={sp.display_units ?? param.default_units}
							isDerived={sp.is_derived ?? false}
							threshold={th}
							annotations={annotationsByParam.get(sp.parameter_id) ?? []}
							seriesIndex={i}
							syncKey={cursorSyncKey}
							chartData={chartDataMap.get(sp.id) ?? null}
							spotData={spotDataMap.get(sp.id) ?? null}
							spotStats={spotStatsMap.get(sp.parameter_id) ?? null}
							{gapThreshold}
							loading={chartLoading}
							onZoomSelect={onChartZoomSelect}
							onResetZoom={onChartResetZoom}
							onSaved={scheduleFetch}
							sensorBands={sensorIdentity?.bands[sp.parameter_id] ?? []}
							calibrationMarkers={sensorIdentity?.calibrations[sp.parameter_id] ?? []}
							{showSensorVectors}
							{showCalibrationMarkers}
							{showAlarmBands}
							activeBreach={activeBreachByParam.get(sp.parameter_id) ?? null}
							nowMs={now}
						/>
					{/if}
				{/each}
				{#if measurementParams.length === 0}
					<p class="text-sm text-brand-muted">No parameters configured for this site.</p>
				{/if}

				<!-- Diagnostics -->
				{#if showDiagnostics && diagnosticParams.length > 0}
					<div class="pt-2">
						<h3 class="text-xs font-semibold uppercase tracking-wider text-brand-muted mb-2">Diagnostics</h3>
						<div class="space-y-3">
							{#each diagnosticParams as sp, i}
								{@const param = parameters.find((p) => p.id === sp.parameter_id)}
								{@const th = effectiveThreshold(sp.parameter_id)}
								{#if param}
									<div id="param-{sp.parameter_id}" class="scroll-mt-24"></div>
									<ParameterChart
										siteId={siteId}
										siteParameterId={sp.id}
										parameterId={sp.parameter_id}
										parameterName={param.name}
										parameterCode={param.code}
										units={sp.display_units ?? param.default_units}
										threshold={th}
										annotations={annotationsByParam.get(sp.parameter_id) ?? []}
										seriesIndex={measurementParams.length + i}
										syncKey={cursorSyncKey}
										chartData={chartDataMap.get(sp.id) ?? null}
										spotData={spotDataMap.get(sp.id) ?? null}
										spotStats={spotStatsMap.get(sp.parameter_id) ?? null}
										{gapThreshold}
										loading={chartLoading}
										onZoomSelect={onChartZoomSelect}
										onResetZoom={onChartResetZoom}
										onSaved={scheduleFetch}
										sensorBands={sensorIdentity?.bands[sp.parameter_id] ?? []}
										calibrationMarkers={sensorIdentity?.calibrations[sp.parameter_id] ?? []}
										{showSensorVectors}
										{showCalibrationMarkers}
										{showAlarmBands}
										activeBreach={activeBreachByParam.get(sp.parameter_id) ?? null}
										nowMs={now}
									/>
								{/if}
							{/each}
						</div>
					</div>
				{/if}
			</div>

			<!-- Shared tooltip (positioned fixed, reads from all charts) -->
			<SharedChartTooltip syncKey={cursorSyncKey} />

		<!-- Parameters tab -->
		{:else if activeKey === 'parameters'}
			<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
				<div class="flex items-center justify-between px-4 py-3 bg-brand-bg border-b border-brand-divider">
					<span class="text-sm font-semibold">Parameters ({siteParameters.filter((sp) => !sp.is_derived).length})</span>
					<Button
						size="sm"
						onclick={() => showAddParameter = !showAddParameter}
					>{showAddParameter ? 'Cancel' : 'Add'}</Button>
				</div>

				{#if showAddParameter}
					<div class="p-4 border-b border-brand-divider bg-brand-bg/50 flex items-end gap-3">
						<div class="flex-1">
							<label for="add-param-select" class="text-xs font-medium block mb-1">Parameter</label>
							<select id="add-param-select" bind:value={addParamId} class="w-full px-3 py-1.5 text-sm border border-brand-divider rounded bg-brand-surface">
								<option value="">Select a parameter…</option>
								{#each unassignedParameters as p}
									<option value={p.id}>{p.name} ({p.code})</option>
								{/each}
							</select>
						</div>
						<Button
							variant="primary"
							size="sm"
							onclick={addParameter}
							disabled={!addParamId || addingParam}
						>{addingParam ? 'Adding…' : 'Add'}</Button>
					</div>
				{/if}

				<table class="w-full text-sm">
					<thead><tr class="bg-brand-bg border-b border-brand-divider">
						<th class="text-left px-4 py-2 font-semibold">Code</th>
						<th class="text-left px-4 py-2 font-semibold">Parameter</th>
						<th class="text-left px-4 py-2 font-semibold">Units</th>
						<th class="text-left px-4 py-2 font-semibold">Interval</th>
						<th class="text-left px-4 py-2 font-semibold">Warning</th>
						<th class="text-left px-4 py-2 font-semibold">Alarm</th>
						<th class="text-right px-4 py-2 font-semibold">Actions</th>
					</tr></thead>
					<tbody>
						{#each siteParameters.filter((sp) => !sp.is_derived) as sp}
							{@const th = effectiveThreshold(sp.parameter_id)}
							{@const disabled = th != null && isThresholdDisabled(th)}
							{@const warn = th && !disabled ? formatThresholdRange(th.warning_min, th.warning_max, paramUnits(sp)) : null}
							{@const alarm = th && !disabled ? formatThresholdRange(th.alarm_min, th.alarm_max, paramUnits(sp)) : null}
							<tr class="border-b border-brand-divider last:border-b-0">
								<td class="px-4 py-2 font-mono text-xs">{paramCode(sp.parameter_id)}</td>
								<td class="px-4 py-2 font-semibold">{paramName(sp.parameter_id)}</td>
								<td class="px-4 py-2 text-brand-muted">{paramUnits(sp)}</td>
								<td class="px-4 py-2 text-brand-muted">{sp.sample_interval_sec ? `${sp.sample_interval_sec}s` : 'None'}</td>
								{#if disabled}
									<td class="px-4 py-2 text-xs text-brand-muted italic" colspan="2">Disabled</td>
								{:else}
									<td class="px-4 py-2 text-xs text-severity-warning">{#if warn}{warn}{:else}<span class="text-brand-muted">None</span>{/if}</td>
									<td class="px-4 py-2 text-xs text-severity-alarm">{#if alarm}{alarm}{:else}<span class="text-brand-muted">None</span>{/if}</td>
								{/if}
								<td class="px-4 py-2 text-right space-x-1">
									<Button
										size="sm"
										onclick={() => openThresholdDialog(sp.parameter_id, paramName(sp.parameter_id))}
									>{th && !disabled ? 'Edit' : 'Set'} thresholds</Button>
									{#if !disabled}
										<Button
											size="sm"
											onclick={() => disableAlarms(sp.parameter_id)}
											class="border-severity-alarm-border text-severity-alarm"
										>Disable alarms</Button>
									{/if}
									<Button
										size="sm"
										onclick={() => openMergeSiteParameter(sp)}
									>Merge…</Button>
									<Button
										size="sm"
										onclick={() => removeParameter(sp.id)}
										class="text-severity-alarm"
									>Remove</Button>
								</td>
							</tr>
						{/each}
						{#if siteParameters.filter((sp) => !sp.is_derived).length === 0}
							<tr><td colspan="7" class="px-4 py-6 text-center text-brand-muted">No parameters configured</td></tr>
						{/if}
					</tbody>
				</table>
			</div>

			<!-- Derived Parameters -->
				<div class="mt-4 rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
					<div class="flex items-center justify-between px-4 py-3 bg-brand-bg border-b border-brand-divider">
						<span class="text-sm font-semibold">Derived Parameters ({assignedDerivedDefs.length})</span>
						<Button
							size="sm"
							onclick={() => showAssignDerived = !showAssignDerived}
						>{showAssignDerived ? 'Cancel' : 'Assign'}</Button>
					</div>

					{#if showAssignDerived}
						<div class="p-4 border-b border-brand-divider bg-brand-bg/50 space-y-2">
							<p class="text-xs text-brand-muted">Select a derived parameter to assign to this site. Greyed out entries are missing required source parameters.</p>
							{#each availableDerivedDefs as { def, allPresent, missing }}
								<div class="flex items-center justify-between p-2 rounded border border-brand-divider {allPresent ? 'bg-brand-surface' : 'bg-brand-bg opacity-60'}">
									<div class="flex-1">
										<span class="text-sm font-medium">{def.name || def.code}</span>
										<span class="text-xs font-mono text-brand-muted ml-2">{def.formula}</span>
										{#if missing.length > 0}
											<p class="text-xs text-severity-alarm mt-0.5">
												Missing: {missing.map((s) => s.variable_name).join(', ')}
											</p>
										{/if}
									</div>
									<Button
										variant="primary"
										size="sm"
										onclick={() => assignDerived(def)}
										disabled={!allPresent || assigningId === def.id}
									>{assigningId === def.id ? 'Assigning…' : 'Assign'}</Button>
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
											<a href="{base}/derived/{d.id}" class="text-brand-primary no-underline hover:underline">{d.name || d.code}</a>
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
												<Button
													size="sm"
													disabled={recomputingId === d.id}
													class="bg-brand-bg hover:bg-brand-surface"
												>{recomputingId === d.id ? 'Computing…' : 'Recompute'}</Button>
											</ConfirmPopover>
											{#if sp}
												{@const confirmKey = `remove-${sp.id}`}
												{#if confirmingRemove === confirmKey}
													<Button variant="danger" size="sm" class="ml-1" onclick={() => { confirmingRemove = null; unassignDerived(sp); }}>Confirm</Button>
													<Button variant="ghost" size="sm" class="ml-1" onclick={() => confirmingRemove = null}>Cancel</Button>
												{:else}
													<Button variant="ghost" size="sm" class="text-severity-alarm hover:text-severity-alarm ml-1" onclick={() => confirmingRemove = confirmKey}>Remove</Button>
												{/if}
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
		{:else if activeKey === 'sensors'}
			<div class="flex items-center justify-between mb-3">
				<span class="text-sm font-semibold">Deployed sensors ({deployedSensors.length})</span>
				<Button size="sm" onclick={() => (deployHereOpen = true)}>Deploy sensor here</Button>
			</div>
			<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
				<table class="w-full text-sm">
					<thead><tr class="bg-brand-bg border-b border-brand-divider">
						<th class="w-8 px-2 py-2"></th>
						<th class="text-left px-4 py-2 font-semibold">Sensor</th>
						<th class="text-left px-4 py-2 font-semibold">Make / Model</th>
						<th class="text-left px-4 py-2 font-semibold">S/N</th>
						<th class="text-left px-4 py-2 font-semibold">Deployed</th>
						<th class="text-left px-4 py-2 font-semibold">Calibration</th>
						<th class="px-4 py-2"></th>
					</tr></thead>
					<tbody>
						{#each deployedSensors as sensor}
							{@const dep = sensorDeployment(sensor.id)}
							{@const cal = sensorLatestCalibration(sensor.id)}
							{@const cals = sensorCalibrations(sensor.id)}
							{@const expanded = expandedSensors.has(sensor.id)}
							<tr class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50 {cals.length ? 'cursor-pointer' : ''}" onclick={() => cals.length && toggleSensorExpanded(sensor.id)}>
								<td class="px-2 py-2 text-center text-brand-muted">{#if cals.length}{expanded ? '▾' : '▸'}{/if}</td>
								<td class="px-4 py-2">
									<a href="{base}/sensors/{sensor.id}" onclick={(e) => e.stopPropagation()} class="font-semibold text-brand-primary no-underline hover:underline">
										{sensor.name ?? sensor.serial_number ?? 'Sensor'}
									</a>
								</td>
								<td class="px-4 py-2 text-brand-muted">{sensor.manufacturer} {sensor.model}</td>
								<td class="px-4 py-2 font-mono text-brand-muted">{sensor.serial_number ?? 'None'}</td>
								<td class="px-4 py-2 text-brand-muted">{dep ? formatRelativeTime(dep.deployed_from) : 'None'}</td>
								<td class="px-4 py-2">
									{#if cal}<span class="font-mono">{cal.slope}x + {cal.intercept}</span> <span class="text-brand-muted text-xs">({formatRelativeTime(cal.valid_from)})</span>{:else}<span class="text-brand-muted">None</span>{/if}
								</td>
								<td class="px-4 py-2 text-right whitespace-nowrap" onclick={(e) => e.stopPropagation()}>
									<Button size="sm" onclick={() => { moveSensor = sensor; moveOpen = true; }}>Move…</Button>
									<ConfirmPopover message="End this deployment now? The sensor leaves this site." confirmLabel="Recall" confirmVariant="primary" onconfirm={() => handleRecallDeployment(sensor.id)}>
										<Button size="sm" class="text-brand-primary">Recall</Button>
									</ConfirmPopover>
								</td>
							</tr>
							{#if expanded}
								<tr class="border-b border-brand-divider last:border-b-0 bg-brand-bg/40">
									<td></td>
									<td colspan="6" class="px-4 py-2">
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
									</td>
								</tr>
							{/if}
						{/each}
						{#if deployedSensors.length === 0}
							<tr><td colspan="7" class="px-4 py-4 text-center text-brand-muted">No sensors currently deployed at this site</td></tr>
						{/if}
					</tbody>
				</table>
			</div>

		<!-- Samples tab -->
		{:else if activeKey === 'samples'}
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
										<td class="px-4 py-2 text-brand-muted">{s.label ?? 'None'}</td>
										<td class="px-4 py-2 text-right font-mono">{s.mean != null ? s.mean.toFixed(3) : 'None'}</td>
										<td class="px-4 py-2 text-right font-mono">{s.stdev != null ? s.stdev.toFixed(3) : 'None'}</td>
										<td class="px-4 py-2 text-right font-mono">{s.n}</td>
										<td class="px-4 py-2 text-right font-mono">{s.min_value != null ? s.min_value.toFixed(3) : 'None'}</td>
										<td class="px-4 py-2 text-right font-mono">{s.max_value != null ? s.max_value.toFixed(3) : 'None'}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>

		<!-- Status tab (admin-only) -->
		{:else if activeKey === 'status'}
			<div class="space-y-3">
				<div class="flex gap-1">
					{#each ['24h', '7d', '30d'] as range}
						<button
							onclick={() => { statusTimeRange = range as typeof statusTimeRange; statusOffset = 0; loadStatusEvents(); }}
							class="px-3 py-1 text-xs rounded-md cursor-pointer border-none {statusTimeRange === range ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted'}"
						>{range}</button>
					{/each}
				</div>
				{#if statusLoading}
					<p class="text-sm text-brand-muted">Loading events…</p>
				{:else if statusEvents.length === 0}
					<div class="rounded-md border border-brand-divider bg-brand-surface p-4 text-sm text-brand-muted space-y-1">
						<p class="font-medium text-brand-text">No status events in this range.</p>
						<p>Status events are non-numeric device messages recorded over time - firmware and connection status, sensor health strings, and error codes. They are separate from the numeric readings shown in the charts.</p>
					</div>
				{:else}
					<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
						<table class="w-full text-sm">
							<thead><tr class="bg-brand-bg border-b border-brand-divider">
								<th class="text-left px-4 py-2 font-semibold">Time</th>
								<th class="text-left px-4 py-2 font-semibold">Parameter</th>
								<th class="text-left px-4 py-2 font-semibold">Status</th>
							</tr></thead>
							<tbody>
								{#each statusEvents as evt}
									<tr class="border-b border-brand-divider last:border-b-0">
										<td class="px-4 py-2 text-xs">{formatDateTime(evt.time)}</td>
										<td class="px-4 py-2 text-xs">{statusEventParamName(evt.parameter_id)}</td>
										<td class="px-4 py-2"><span class="px-2 py-0.5 text-xs rounded-full bg-brand-bg text-brand-muted">{evt.value}</span></td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					<PaginationControls
						total={statusTotal}
						page={statusPage}
						perPage={STATUS_PAGE_SIZE}
						onPageChange={(p) => { statusOffset = (p - 1) * STATUS_PAGE_SIZE; loadStatusEvents(); }}
					/>
				{/if}
			</div>

		<!-- Notes tab -->
		{:else if activeKey === 'notes'}
			<div class="space-y-3">
				<Button variant="primary" onclick={() => addNoteOpen = true}>Add Note</Button>
				{#each notes as note}
					<div class="rounded-md border border-brand-divider bg-brand-surface p-3">
						<div class="flex items-start justify-between">
							<p class="text-sm whitespace-pre-wrap">{note.text}</p>
							<ConfirmPopover message="Delete this note?" confirmLabel="Delete" onconfirm={() => deleteNote(note.id)}>
								<Button variant="ghost" size="sm" class="text-severity-alarm hover:text-severity-alarm ml-2 shrink-0">Delete</Button>
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

		{/if}
	</div>

	<!-- Add Note Dialog -->
	<Dialog bind:open={addNoteOpen} title="Add Note" maxWidth="sm">
		{#snippet children()}
			<textarea bind:value={newNoteText} rows="4" placeholder="Write a note…" class="w-full px-3 py-2 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"></textarea>
		{/snippet}
		{#snippet actions()}
			<Button onclick={() => addNoteOpen = false}>Cancel</Button>
			<Button variant="primary" onclick={addNote} disabled={savingNote || !newNoteText.trim()}>{savingNote ? 'Saving…' : 'Save'}</Button>
		{/snippet}
	</Dialog>

	<!-- Export Dialog -->
	<Dialog bind:open={exportOpen} title="Export Data" maxWidth="sm">
		{#snippet children()}
			<div class="space-y-3">
				<div class="rounded-md border border-brand-divider bg-brand-bg px-3 py-3 overflow-hidden">
					<TimeRangeSlider
						min={sliderMin}
						max={sliderMax}
						bind:start={exportStartMs}
						bind:end={exportEndMs}
					/>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="exp-start" class="text-sm font-medium block mb-1">Start</label>
						<input id="exp-start" type="datetime-local" value={exportStartStr} onchange={onExportStartInput} class="w-full px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-sm" />
					</div>
					<div>
						<label for="exp-end" class="text-sm font-medium block mb-1">End</label>
						<input id="exp-end" type="datetime-local" value={exportEndStr} onchange={onExportEndInput} class="w-full px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-sm" />
					</div>
				</div>
				<div>
					<label class="text-sm font-medium block mb-1">Parameters</label>
					<div class="max-h-32 overflow-y-auto border border-brand-divider rounded-md p-2 space-y-1">
						<label class="flex items-center gap-2 cursor-pointer text-xs text-brand-muted">
							<input type="checkbox" checked={exportSelectedParamIds.length === 0} onchange={() => exportSelectedParamIds = []} /> All parameters
						</label>
						{#each siteParameters.filter((sp) => !sp.is_derived) as sp}
							<label class="flex items-center gap-2 cursor-pointer text-xs">
								<input type="checkbox" value={sp.parameter_id} bind:group={exportSelectedParamIds} /> {paramName(sp.parameter_id)}
							</label>
						{/each}
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
				{#if exportResolution === 'raw'}
					<div>
						<label for="exp-mt" class="text-sm font-medium block mb-1">Measurement type</label>
						<select id="exp-mt" bind:value={exportMeasurementType} class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
							<option value="all">All (sensor + grab samples)</option>
							<option value="continuous">Continuous (sensor only)</option>
							<option value="spot">Spot (grab samples only)</option>
							<option value="derived">Derived</option>
						</select>
					</div>
					<div class="flex flex-col gap-1">
						<label class="flex items-center gap-2 cursor-pointer text-sm">
							<input type="checkbox" bind:checked={exportIncludeFlagged} /> Include flagged readings (with flag metadata)
						</label>
						<label class="flex items-center gap-2 cursor-pointer text-sm">
							<input type="checkbox" bind:checked={exportIncludeReplicates} /> Include all replicates (multiple measurements per time point)
						</label>
					</div>
				{/if}
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
			<Button onclick={() => exportOpen = false}>Cancel</Button>
			<Button variant="primary" onclick={handleExport} disabled={exportLoading}>{exportLoading ? 'Exporting…' : 'Download'}</Button>
		{/snippet}
	</Dialog>

	{#if site}
		<ThresholdDialog
			bind:open={thresholdDialogOpen}
			siteId={site.id}
			parameterId={thresholdEditingParamId}
			parameterName={thresholdEditingParamName}
			existing={thresholds.find((t) => t.parameter_id === thresholdEditingParamId && t.site_id === site?.id) ?? null}
			onsuccess={reloadThresholds}
		/>

		{#if deployHereOpen}
			<DeployMoveSensorDialog
				bind:open={deployHereOpen}
				mode="site"
				siteId={site.id}
				siteName={site.name}
				onsuccess={reloadDeployments}
			/>
		{/if}

		{#if moveOpen && moveSensor}
			<DeployMoveSensorDialog
				bind:open={moveOpen}
				mode="sensor"
				sensorId={moveSensor.id}
				sensorName={moveSensor.name ?? moveSensor.serial_number ?? 'sensor'}
				currentSiteName={site.name}
				onsuccess={reloadDeployments}
			/>
		{/if}

		{#if mergeOpen && mergeSource}
			<MergeSiteParameterDialog
				bind:open={mergeOpen}
				source={mergeSource}
				candidates={siteParameters.filter((s) => !s.is_derived).map((s) => ({ id: s.id, label: paramName(s.parameter_id) }))}
				onsuccess={reloadSiteParameters}
			/>
		{/if}
	{/if}
{/if}
