<script lang="ts">
	import type { SdEstimator } from '$lib/sdEstimator';
	import { provenanceKindLabel } from '$lib/origin';
	import { measuringInstruments } from '$lib/instruments/kind';
	import { onMount, onDestroy, untrack } from 'svelte';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { api, type Site, type Project, type SiteParameter, type Parameter, type Sensor, type SensorDeployment, type SensorCalibration, type Note, type AlarmThreshold, type DerivedParameter, type ParameterGroup, type ParameterGroupMember, type Sample, type Annotation, type Subproject } from '$api/crud';
	import { GET, POST, PATCH } from '$api/client';
	import { listAll } from '$api/paged';
	import { calculationsBySlot, groupSlots, type SlotCalculation } from '$lib/calculations/siteSlots';
	import { applyParameterGroup, recomputeDerived, getThresholds, getActiveAlarms, getCalculationClosure, getGroupDefinition, getSiteExportSummary, type ThresholdWithValue, type ActiveAlarm, type ExportSummary } from '$api/service';
	import { getSiteSensorIdentity, type SensorIdentityResponse } from '$api/sensors';
	import {
		annotationsByParameter,
		continuousSeries,
		max,
		mean,
		mergeOriginLabels,
		min,
		nullPct,
		originLabelOf,
		spotSeries,
		stddev,
		type SampleCurve,
	} from '$lib/sites/chartSeries';
	import type { AggregatesParameter, AggregatesResponse, ReadingsResponse } from '$lib/api/types';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { siteNavigator } from '$lib/stores/sites.svelte';
	import { formatRelativeTime, formatDateTime, formatDate, toDatetimeLocal, fromDatetimeLocal } from '$lib/utils';
	import { timezoneStore } from '$lib/stores/timezone.svelte';
	import Button from '$components/ui/Button.svelte';
	import Tabs from '$components/ui/Tabs.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import PaginationControls from '$components/ui/PaginationControls.svelte';
	import SensorVsGrabPanel from '$components/sites/SensorVsGrabPanel.svelte';
	import SiteVisitsTab from '$components/sites/SiteVisitsTab.svelte';
	import SiteExportDialog from '$components/sites/SiteExportDialog.svelte';
	import SiteStatusTab from '$components/sites/SiteStatusTab.svelte';
	import { buildReadingsExportParams, exportColumns } from '$lib/sites/exportParams';
	import { readPointParams, writePointParams, type PointRef } from '$lib/provenance/pointLink';
	import Badge from '$components/ui/Badge.svelte';
	import Breadcrumbs from '$components/ui/Breadcrumbs.svelte';
	import ThresholdDialog from '$components/dialogs/ThresholdDialog.svelte';
	import DeployMoveSensorDialog from '$components/dialogs/DeployMoveSensorDialog.svelte';
	import MergeSiteParameterDialog from '$components/dialogs/MergeSiteParameterDialog.svelte';
	import ConfirmSiteParameterButton from '$components/parameters/ConfirmSiteParameterButton.svelte';
	import CalculationChip from '$components/calculations/CalculationChip.svelte';
	import PointInspector from '$components/provenance/PointInspector.svelte';
	import ReplicateFlagDialog from '$components/dialogs/ReplicateFlagDialog.svelte';
	import ParameterChart, { type ChartData } from '$components/charts/ParameterChart.svelte';
	import { GAP_THRESHOLDS } from '$lib/charts/uPlotTheme';
	import { autoResolution, type Frequency } from '$lib/charts/multiSiteSeries';
	import { initialChartRange } from '$lib/charts/initialRange';
	import type { SpotPointStats } from '$lib/charts/spotMarkers';
	import FrequencyChips from '$components/charts/FrequencyChips.svelte';
	import SharedChartTooltip from '$components/charts/SharedChartTooltip.svelte';
	import TimeRangeSlider from '$components/charts/TimeRangeSlider.svelte';
	import ResolutionChips from '$components/charts/ResolutionChips.svelte';
	import { formatWindowLabel } from '$lib/charts/multiSiteSeries';
	import type { SampleReplicate, SampleStat } from '$lib/api/types';
	import { curveRefs } from '$lib/curveRefs.svelte';
	import { formatEquation } from '$lib/standardCurves';
	import { eventBus, INGEST_COALESCE_MS } from '$lib/stores/events.svelte';
	import { formatThresholdRange } from '$lib/alarms';
	import { me } from '$auth/me.svelte';
	import { formatMeasurement , NO_VALUE} from '$lib/format';

	let site = $state<Site | null>(null);
	let project = $state<Project | null>(null);
	let siteParameters = $state<SiteParameter[]>([]);
	// The comparison needs a global parameter the site configures; the label is the slot's own.
	const comparisonParameters = $derived(
		siteParameters
			.map((sp) => ({
				id: sp.parameter_id,
				label: sp.name ?? parameters.find((p) => p.id === sp.parameter_id)?.name ?? sp.parameter_id,
			}))
			.sort((a, b) => a.label.localeCompare(b.label)),
	);
	let parameters = $state<Parameter[]>([]);
	let sensors = $state<Sensor[]>([]);
	let deployments = $state<SensorDeployment[]>([]);
	let calibrations = $state<SensorCalibration[]>([]);
	let notes = $state<Note[]>([]);
	let thresholds = $state<AlarmThreshold[]>([]);
	let derivedDefs = $state<DerivedParameter[]>([]);
	let parameterGroups = $state<ParameterGroup[]>([]);
	let groupMembers = $state<ParameterGroupMember[]>([]);
	let slotCalculations = $state<Map<string, SlotCalculation[]>>(new Map());
	let collapsedGroups = $state<string[]>([]);
	let samples = $state<Sample[]>([]);
	let samplesLoading = $state(false);
	const SAMPLES_PER_PAGE = 50;
	let samplesPage = $state(1);
	let samplesTotal = $state(0);
	let samplesSiteId = '';
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
		{ key: 'visits', label: 'Visits' },
		{ key: 'comparison', label: 'Sensor vs grab' },
		...(me.can('admin') ? [{ key: 'status', label: 'Status' }] : []),
		{ key: 'notes', label: 'Notes' },
	]);
	const tabLabels = $derived(tabDefs.map((t) => t.label));
	const activeKey = $derived(tabDefs[activeTab]?.key ?? 'charts');

	// URL-synced tab (?tab=), so visits and provenance links can land on a specific tab. The reader
	// must not track `activeTab`: a click sets it before the writeback lands, so tracking it would
	// re-run this from the stale URL and snap the tab back, locking the page on its first choice.
	$effect(() => {
		const wanted = page.url.searchParams.get('tab');
		if (!wanted) return;
		const idx = tabDefs.findIndex((t) => t.key === wanted);
		if (idx >= 0 && idx !== untrack(() => activeTab)) activeTab = idx;
	});
	$effect(() => {
		const key = activeKey;
		const current = page.url.searchParams.get('tab') ?? 'charts';
		if (current === key) return;
		// A named tab this render can't resolve is a deep link waiting on data (Status appears only
		// once the caller's role has loaded). Writing back would erase the request before it lands.
		if (!tabDefs.some((t) => t.key === current)) return;
		const url = new URL(page.url.href);
		if (key === 'charts') url.searchParams.delete('tab');
		else url.searchParams.set('tab', key);
		if (key !== 'visits') url.searchParams.delete('event');
		if (key !== 'charts') writePointParams(url.searchParams, null);
		goto(url, { replaceState: true, noScroll: true, keepFocus: true });
	});
	let statsOpen = $state(false);
	let recomputingId = $state<string | null>(null);
	let confirmingRemove = $state<string | null>(null);

	// --- Point inspector: the pinned provenance record under a clicked chart point ---
	let inspector = $state<{
		siteParameterId: string;
		parameterId: string;
		parameterName: string;
		timeIso: string;
		measurementType: 'continuous' | 'spot';
	} | null>(null);
	// Series-level origin labels by site_parameter id, kept across fetches (an aggregate-only
	// fetch carries no origins and must not erase what a raw fetch learned).
	let originLabels = $state<Map<string, string>>(new Map());
	// The replicate flag dialog, opened from a point record under a chart or in a visit. The
	// replicates come from the record itself; `onSaved` refreshes whichever surface opened it.
	let flagTarget = $state<{
		parameterId: string;
		parameterName: string;
		timeIso: string;
		replicates: SampleReplicate[];
		onSaved: () => void;
	} | null>(null);
	let flagOpen = $state(false);
	// Bumped after a curation write so a fetched record re-reads itself.
	let inspectorRevision = $state(0);

	// The open chart record travels in the URL (?point=&t=&mt=), so it can be linked and survives a
	// reload. The reader runs once the site's parameters are known and before the writer may run,
	// or the writer would erase the link it was about to restore.
	let pointRestored = $state(false);
	$effect(() => {
		if (pointRestored || siteParameters.length === 0) return;
		const ref = readPointParams(page.url.searchParams);
		const sp = ref ? siteParameters.find((s) => s.id === ref.siteParameterId) : null;
		if (ref && sp) {
			untrack(() => {
				inspector = {
					siteParameterId: sp.id,
					parameterId: sp.parameter_id,
					parameterName: paramName(sp.parameter_id),
					timeIso: ref.timeIso,
					measurementType: ref.measurementType,
				};
			});
		}
		pointRestored = true;
	});
	$effect(() => {
		if (!pointRestored || activeKey !== 'charts') return;
		const wanted: PointRef | null = inspector
			? {
					siteParameterId: inspector.siteParameterId,
					timeIso: inspector.timeIso,
					measurementType: inspector.measurementType,
				}
			: null;
		const current = readPointParams(page.url.searchParams);
		if (JSON.stringify(current) === JSON.stringify(wanted)) return;
		const url = new URL(page.url.href);
		writePointParams(url.searchParams, wanted);
		goto(url, { replaceState: true, noScroll: true, keepFocus: true });
	});

	function chartPointLink(ref: PointRef): string {
		const url = new URL(`${base}/sites/${siteId}`, page.url.origin);
		writePointParams(url.searchParams, ref);
		return url.toString();
	}

	function visitPointLink(eventId: string, parameterId: string): string {
		const url = new URL(`${base}/sites/${siteId}`, page.url.origin);
		url.searchParams.set('tab', 'visits');
		url.searchParams.set('event', eventId);
		const sp = siteParameters.find((s) => s.parameter_id === parameterId);
		if (sp) url.searchParams.set('point', sp.id);
		return url.toString();
	}


	function pinInspector(
		sp: SiteParameter,
		name: string,
		p: { timeMs: number; measurementType: 'continuous' | 'spot' },
	) {
		inspector = {
			siteParameterId: sp.id,
			parameterId: sp.parameter_id,
			parameterName: name,
			timeIso: new Date(p.timeMs).toISOString(),
			measurementType: p.measurementType,
		};
	}

	function openChartFlag(sp: SiteParameter, name: string, replicates: SampleReplicate[]) {
		if (!inspector) return;
		flagTarget = {
			parameterId: sp.parameter_id,
			parameterName: name,
			timeIso: inspector.timeIso,
			replicates,
			onSaved: () => {
				scheduleFetch();
				inspectorRevision += 1;
			},
		};
		flagOpen = true;
	}



	// Inline subproject move: the picker lists every subproject (Project - Subproject), so a site can
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
					label: `${projectNames.get(s.project_id) ?? '-'} - ${s.name}`,
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
	let resolvedThresholds = $state<Map<string, ThresholdWithValue>>(new Map());

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
	//   high = continuous field-sensor line, low = discrete spot/grab markers, all = both (default).
	let frequency = $state<Frequency>('all');
	// Plot every replicate behind a spot mean, not just the mean and its sd bar.
	let showReplicates = $state(false);
	// A retraction is reversible and by decision not a delete, so it is drawn on request rather
	// than left as an absence. The count below is served either way.
	let showWithdrawn = $state(false);
	let withdrawnCounts = $state<Map<string, number>>(new Map());

	let sliderMax = $state(Date.now());
	let sliderMin = $state(Date.now() - 90 * 86400000);
	let chartStart = $state(Date.now() - 604800000);
	let chartEnd = $state(Date.now());

	interface SiteDetailParameter {
		id: string;
		code?: string;
		name?: string;
		units?: string | null;
		entry_mode?: string;
		sensor_type?: string | null;
		data_start?: string | null;
		data_end?: string | null;
		reading_count?: number | null;
		has_continuous?: boolean;
		has_spot?: boolean;
		frequency?: 'high' | 'low' | 'mixed';
		external_source?: { system: string; station: string; attribution: string } | null;
	}
	interface SiteDetailResponse {
		data_start: string | null;
		data_end: string | null;
		reading_count: number;
		parameters: SiteDetailParameter[];
	}

	let paramExtents = $state<Map<string, SiteDetailParameter>>(new Map());

	// Which cadences the site actually holds, over its whole record. Drives the Frequency chips so
	// a cadence with nothing behind it can't be selected into an empty set of charts.
	const frequencyAvailable = $derived.by(() => {
		const rows = [...paramExtents.values()];
		const avail = {
			high: rows.some((p) => p.has_continuous),
			low: rows.some((p) => p.has_spot),
		};
		// A site with no readings at all reports neither; leave every chip live rather than
		// locking the control over a site that simply has nothing yet.
		return avail.high || avail.low ? avail : { high: true, low: true };
	});

	// A chart empty because the Frequency filter excludes the only cadence this parameter holds
	// says so, rather than reading as a gap in the record.
	function emptyMessageFor(siteParameterId: string): string {
		const ext = paramExtents.get(siteParameterId);
		if (!ext) return 'No data for selected range';
		if (frequency === 'low' && !ext.has_spot) return 'No low-frequency (grab/spot) data for this parameter';
		if (frequency === 'high' && !ext.has_continuous) return 'No continuous (sensor) data for this parameter';
		return 'No data for selected range';
	}

	let sliderRef: TimeRangeSlider | undefined = $state();

	const chartResolution = $derived<'raw' | 'hourly' | 'daily'>(
		resolutionOverride === 'auto' ? autoResolution(chartStart, chartEnd) : resolutionOverride
	);

	const gapThreshold = $derived(GAP_THRESHOLDS[chartResolution] ?? 0);

	const windowDuration = $derived((chartEnd - chartStart) / 86400000);
	const windowLabel = $derived(formatWindowLabel(windowDuration));

	// Shared data fetch - one request for all charts
	let chartLoading = $state(false);
	let chartDataMap = $state<Map<string, ChartData>>(new Map());
	// Spot/grab samples per site_parameter id, drawn as discrete markers (Low/All frequency).
	let spotDataMap = $state<Map<string, ChartData>>(new Map());
	// Replicate mean±sd whisker stats per global parameter_id, keyed by epoch ms of collected_at.
	let spotStatsMap = $state<Map<string, Map<number, SpotPointStats>>>(new Map());
	// Standard curve behind each sample in the loaded window, keyed by sample id. Replicates of one
	let sampleCurves = $state<Map<string, SampleCurve>>(new Map());
	let annotationsByParam = $state<Map<string, Annotation[]>>(new Map());
	let showSensorVectors = $state(false);
	let showCalibrationMarkers = $state(false);
	// One aggregate line per instrument rather than the count-weighted merge, so a step at a
	// sensor swap can be attributed. Aggregates only: the raw arm has no sensor dimension.
	let splitBySensor = $state(false);
	// Per-slot extra lines when split is on, keyed by site_parameter id, plus the label of the
	// series the chart draws as its own.
	let sensorSplitMap = $state<Map<string, Array<{ label: string; values: (number | null)[] }>>>(new Map());
	let firstSensorLabels = $state<Map<string, string>>(new Map());

	/// An instrument's name for the legend: its serial or name where the identity fetch knows it,
	/// else the short id, else "unattributed" for the rows no instrument owns.
	function sensorSeriesLabel(sensorId: string | null | undefined): string {
		if (!sensorId) return 'unattributed';
		for (const bands of Object.values(sensorIdentity?.bands ?? {})) {
			const band = bands.find((b) => b.sensor_id === sensorId);
			if (band) return band.sensor_serial ?? band.sensor_name ?? sensorId.slice(0, 8);
		}
		return sensorId.slice(0, 8);
	}
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
		void showSensorVectors; void showCalibrationMarkers; void frequency; void showWithdrawn;
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
					? GET<ReadingsResponse>(`/api/sites/${siteId}/readings`, { start: startDate, end: endDate, measurement_type: 'continuous', include_origin: 'true' })
					: GET<AggregatesResponse>(`/api/sites/${siteId}/aggregates/${res}`, { start: startDate, end: endDate, ...(splitBySensor ? { split_by_sensor: 'true' } : {}) });
			// Spot values arrive as sample means with per-point stats and replicates inline. Only spot
			// rows can carry a standard curve, so include_curves rides on this fetch alone and the
			// continuous payload is left as it was.
			const spotPromise = wantSpot
				? GET<ReadingsResponse>(`/api/sites/${siteId}/readings`, { start: startDate, end: endDate, measurement_type: 'spot', include_sample_stats: 'true', include_curves: 'true', include_origin: 'true', ...(showWithdrawn ? { include_withdrawn: 'true' } : {}) }).catch(() => null)
				: Promise.resolve(null);
			const annotationsPromise = GET<Annotation[]>(`/api/sites/${siteId}/annotations`, { start: startDate, end: endDate })
				.catch(() => [] as Annotation[]);
			const identityPromise = (showSensorVectors || showCalibrationMarkers)
				? getSiteSensorIdentity(siteId, { start: startDate, end: endDate }).catch(() => null)
				: Promise.resolve(null);

			const [result, spotResult, anns, identity] = await Promise.all([dataPromise, spotPromise, annotationsPromise, identityPromise]);
			if (gen === fetchGeneration) sensorIdentity = identity;
			if (gen !== fetchGeneration) return;

			const continuous = continuousSeries(result, res, splitBySensor, sensorSeriesLabel);
			chartDataMap = continuous.map;
			if (res !== 'raw' && result?.times?.length) {
				sensorSplitMap = continuous.splits;
				firstSensorLabels = continuous.firsts;
			}

			const spot = spotSeries(spotResult);
			spotDataMap = spot.map;
			spotStatsMap = spot.stats;
			withdrawnCounts = spot.withdrawnCounts;
			sampleCurves = spot.curves;
			curveRefs.ensureCalibrations(spot.calibrationIds);
			curveRefs.ensureStandardCurves(spot.standardCurveIds);

			originLabels = mergeOriginLabels(originLabels, [result, spotResult]);
			annotationsByParam = annotationsByParameter(anns);
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

	// The export dialog's own state lives in the component; the page owns only whether it is open.
	let exportOpen = $state(false);


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
	let ingestTimer: ReturnType<typeof setTimeout> | null = null;

	async function loadSite() {
		const id = siteId;
		loading = true;
		error = null;
		// Clear per-site state so the previous site's data can't linger while the new one loads.
		site = null;
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
		// A linked point record opens on a day around its instant unless the window was pinned too.
		const pointRef = readPointParams(page.url.searchParams);
		if (!deepLink && pointRef) {
			const t = new Date(pointRef.timeIso).getTime();
			chartStart = t - 43_200_000;
			chartEnd = t + 43_200_000;
			deepLink = true;
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
			// Only what something could have been measured on is offered as a slot's instrument.
			sensors = measuringInstruments(sens.data);
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
				// A single-cadence site opens on that cadence; a mixed one keeps the All default.
				{
					const withData = detailRes.parameters.filter((p) => (p.reading_count ?? 0) > 0);
					if (withData.length > 0) {
						if (withData.every((p) => p.frequency === 'low')) frequency = 'low';
						else if (withData.every((p) => p.frequency === 'high')) frequency = 'high';
					}
				}
				if (deepLink) {
					// Pinned window from a deep link: widen the slider bounds to fit it.
					sliderMin = Math.min(sliderMin, chartStart);
					sliderMax = Math.max(sliderMax, chartEnd);
				} else {
					// The last 7 days of available data for a logger, the spot span for grab data:
					// a week of a campaign record is usually empty. The cadence resolved just above
					// is what the charts will actually draw.
					const range = initialChartRange(
						detailRes.parameters ?? [],
						{ minMs: sliderMin, maxMs: sliderMax },
						frequency,
					);
					chartStart = range.startMs;
					chartEnd = range.endMs;
					sliderMin = Math.min(sliderMin, chartStart);
					sliderMax = Math.max(sliderMax, chartEnd);
				}
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

		samplesSiteId = id;
		samplesPage = 1;
		try {
			const [derivedResult, groupResult] = await Promise.all([
				api.derivedParameters.list({ perPage: 200 }),
				api.parameterGroups.list({ perPage: 200, sort: ['ordinal', 'ASC'] }),
				loadSamples(),
			]);
			derivedDefs = derivedResult.data;
			parameterGroups = groupResult.data;
		} catch (e) {
			toastStore.error(e instanceof Error ? `Failed to load derived parameters / samples: ${e.message}` : 'Failed to load derived parameters / samples');
		}
	}

	async function loadSamples() {
		if (!samplesSiteId) return;
		samplesLoading = true;
		try {
			const result = await api.samples.list({
				page: samplesPage,
				perPage: SAMPLES_PER_PAGE,
				filter: { site_id: samplesSiteId },
				sort: ['collected_at', 'DESC'],
			});
			samples = result.data;
			samplesTotal = result.total;
		} finally {
			samplesLoading = false;
		}
	}

	// (Re)load whenever the site id or deep-link window changes. SvelteKit reuses this component when
	// navigating between two /sites/[id] pages, so onMount fires only once. Without this, clicking an
	// alarm for a different site (e.g. from the notification bell) would change the URL but not the page.
	let loadedKey = '';
	$effect(() => {
		// The tab and expanded-visit params are page-local UI state, not a different site view:
		// excluding them keeps a tab switch from refetching everything.
		const params = new URLSearchParams(page.url.search);
		params.delete('tab');
		params.delete('event');
		const key = `${siteId}|${params.toString()}`;
		if (key === loadedKey) return;
		loadedKey = key;
		untrack(() => {
			loadSite();
		});
	});

	onMount(() => {
		nowTimer = setInterval(() => { now = Date.now(); }, 30_000);
		// Coalesce the cycle's events into one reaction. Per event this issued an alarm query plus
		// a chart fetch (itself up to four requests), none of which could be served from cache
		// because an ingest drops the site's cached responses. `wasAtMax` is evaluated when the
		// burst settles rather than on its first event, so a slider drag partway through the burst
		// is respected instead of being overridden by a later event.
		unsubEvents = eventBus.subscribe('data_ingested', (event: any) => {
			if (!site) return;
			if (event.site_id !== site.id) return;
			const forSite = site.id;
			if (ingestTimer) clearTimeout(ingestTimer);
			ingestTimer = setTimeout(() => {
				ingestTimer = null;
				// The route reuses this component across sites, so a burst that started before a
				// navigation must not refetch against the site the user has since moved to.
				if (site?.id !== forSite) return;
				loadActiveBreaches();
				if (autoUpdate) {
					const wasAtMax = Math.abs(chartEnd - sliderMax) < 60000;
					sliderMax = Date.now();
					if (wasAtMax) chartEnd = sliderMax;
					scheduleFetch();
				} else {
					newDataAvailable = true;
				}
			}, INGEST_COALESCE_MS);
		});
	});

	onDestroy(() => {
		unsubEvents?.();
		if (nowTimer) clearInterval(nowTimer);
		if (ingestTimer) clearTimeout(ingestTimer);
	});

	function paramName(paramId: string): string { return parameters.find((p) => p.id === paramId)?.name ?? 'None'; }

	// The unit a slot serves: the site's override where it has one, else the catalog default. Any
	// table printing a number for a parameter names it, since sites can disagree (ppb against ppt).
	function unitsForParameter(paramId: string): string | null {
		const sp = siteParameters.find((s) => s.parameter_id === paramId);
		return sp?.display_units ?? parameters.find((p) => p.id === paramId)?.default_units ?? null;
	}

	const withdrawnTotal = $derived([...withdrawnCounts.values()].reduce((a, b) => a + b, 0));

	/** The divisor the slot declares; null is undeclared, which the key names as such. */
	function sdEstimatorFor(paramId: string): SdEstimator | null {
		const declared = siteParameters.find((s) => s.parameter_id === paramId)?.sd_estimator;
		return declared === 'population' || declared === 'sample' ? declared : null;
	}

	/** The precision the slot declares (`site_parameters.decimal_places`), null when it declares none. */
	function decimalsForParameter(paramId: string): number | null {
		return siteParameters.find((s) => s.parameter_id === paramId)?.decimal_places ?? null;
	}

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

	// Which instrument measures a slot is declared here and nowhere else: an entered or calculated
	// value takes it, instead of inheriting whichever instrument a chosen curve belonged to.
	async function declareInstrument(sp: SiteParameter, sensorId: string) {
		try {
			await api.siteParameters.update(sp.id, { instrument_sensor_id: sensorId || null });
			await reloadSiteParameters();
			toastStore.success(
				sensorId
					? `${paramName(sp.parameter_id)} is measured by ${sensorName(sensorId)}`
					: `${paramName(sp.parameter_id)} declares no instrument`,
			);
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Could not declare the instrument');
		}
	}

	// The slot's own configuration is edited here and nowhere else (Q71): its entity list was
	// unreachable, and these are the fields a site's parameter row is read by.
	async function updateSlot(sp: SiteParameter, patch: Partial<SiteParameter>, what: string) {
		try {
			await api.siteParameters.update(sp.id, patch);
			await reloadSiteParameters();
			toastStore.success(`${paramName(sp.parameter_id)}: ${what} saved`);
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : `Could not save the ${what}`);
		}
	}

	/** An empty field clears the column; anything unparseable leaves it as it was. */
	function slotNumber(raw: string): number | null | undefined {
		if (raw.trim() === '') return null;
		const n = Number(raw);
		return Number.isFinite(n) ? n : undefined;
	}

	function sensorName(sensorId: string): string {
		return sensors.find((s) => s.id === sensorId)?.name ?? sensorId.slice(0, 8);
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



	// The slots under the group that brought them in, and the calculation over each. A calculation
	// belongs to no group, so what ties the two is the parameters they share: the closure names the
	// calculations this site's slots feed, and a group's definition names the page each one lives on.
	const slotGroups = $derived(groupSlots(siteParameters, groupMembers, parameterGroups, slotCalculations));

	function toggleGroup(key: string) {
		collapsedGroups = collapsedGroups.includes(key)
			? collapsedGroups.filter((k) => k !== key)
			: [...collapsedGroups, key];
	}

	async function loadSlotCalculations(parameterIds: string[]) {
		if (parameterIds.length === 0) {
			slotCalculations = new Map();
			return;
		}
		try {
			if (groupMembers.length === 0) {
				groupMembers = await listAll<ParameterGroupMember>(api.parameterGroupMembers, { perPage: 500 });
			}
			const held = new Set(
				groupMembers.filter((m) => parameterIds.includes(m.parameter_id)).map((m) => m.group_id),
			);
			const [closure, definitions] = await Promise.all([
				getCalculationClosure({ parameter_ids: parameterIds.join(','), site_id: siteId }),
				Promise.all([...held].map((groupId) => getGroupDefinition(groupId, siteId))),
			]);
			const ids = new Map(
				definitions.flatMap((d) => d.calculations.map((c) => [c.name, c.id] as const)),
			);
			slotCalculations = calculationsBySlot(closure.calculations, ids);
		} catch {
			// The tab reads without the chips.
		}
	}

	// Applying a group, adding a parameter and assigning a definition each reload the slots, and
	// what is calculated here follows whenever that set moves.
	let loadedSlotKey = '';
	$effect(() => {
		const parameterIds = [...new Set(siteParameters.map((sp) => sp.parameter_id))].sort();
		const key = `${siteId}|${parameterIds.join(',')}`;
		if (key === loadedSlotKey) return;
		loadedSlotKey = key;
		untrack(() => loadSlotCalculations(parameterIds));
	});

	// Derived parameters
	const siteParameterIds = $derived(new Set(siteParameters.map((sp) => sp.parameter_id)));
	// A computed slot names no definition: the one that fills it is the definition whose output is
	// the slot's parameter.
	const computedParameterIds = $derived(new Set(
		siteParameters.filter((sp) => sp.entry_mode === 'tool').map((sp) => sp.parameter_id)
	));

	// A formula of a calculation is declared by applying that calculation's parameter group, which
	// brings its inputs and its outputs in together. What is assigned one at a time here is the
	// standalone kind, which belongs to no calculation and is what the continuous engine computes.
	const standaloneDerivedDefs = $derived(derivedDefs.filter((d) => !d.tool_script_id));

	// Derived defs that are assigned to this site
	const assignedDerivedDefs = $derived(
		standaloneDerivedDefs.filter((d) => !!d.output_parameter_id && computedParameterIds.has(d.output_parameter_id))
	);

	// Availability check for each unassigned derived def
	const availableDerivedDefs = $derived(
		standaloneDerivedDefs
			.filter((d) => !assignedDerivedDefs.includes(d))
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

	let showApplyGroup = $state(false);
	let applyGroupId = $state('');
	let applyingGroup = $state(false);

	// A group is declared whole: the parameters entered at a visit and the ones its calculations
	// publish, so every calculation of the group applies here.
	async function applyGroup() {
		if (!applyGroupId) return;
		applyingGroup = true;
		try {
			const applied = await applyParameterGroup(siteId, applyGroupId);
			const sp = await api.siteParameters.list({ perPage: 200, filter: { site_id: siteId } });
			siteParameters = sp.data;
			applyGroupId = '';
			showApplyGroup = false;
			toastStore.success(
				`${applied.created.length} added, ${applied.existing.length} already here`,
			);
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to apply group');
		} finally { applyingGroup = false; }
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
				entry_mode: 'tool',
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

	function fmt(val: number | null, decimals = 2): string {
		return formatMeasurement(val, decimals);
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
				mean: mean(vals),
				min: min(vals),
				max: max(vals),
				stddev: stddev(vals),
				nullPct: nullPct(vals),
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

<svelte:head><title>{site?.name ?? 'Site'} | RIVER Data</title></svelte:head>

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
						<span class="text-brand-text">{currentSubprojectName ?? '-'}</span>
						<button onclick={openSubprojectPicker} class="text-brand-primary cursor-pointer hover:underline" title="Move this site to another subproject (or project)">Change</button>
					{/if}
				</div>
			</div>
			<div class="flex gap-2">
				<Button onclick={() => (exportOpen = true)}>Export</Button>
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
						<FrequencyChips bind:value={frequency} available={frequencyAvailable} />

						{#if diagnosticParams.length > 0}
							<div class="w-px h-5 bg-brand-divider mx-1"></div>
							<label class="flex items-center gap-1.5 cursor-pointer text-xs text-brand-muted">
								<input type="checkbox" bind:checked={showDiagnostics} />
								Show diagnostics
							</label>
						{/if}

						<div class="w-px h-5 bg-brand-divider mx-1"></div>
						<label class="flex items-center gap-1.5 cursor-pointer text-xs text-brand-muted" title="Plot each replicate behind a grab mean as its own dot">
							<input type="checkbox" bind:checked={showReplicates} /> Replicates
						</label>
						<label
							class="flex items-center gap-1.5 cursor-pointer text-xs text-brand-muted"
							title="Draw instants the source has taken back. They are not served and the retraction is reversible."
						>
							<input type="checkbox" bind:checked={showWithdrawn} />
							Retracted{withdrawnTotal > 0 ? ` (${withdrawnTotal})` : ''}
						</label>
						<label class="flex items-center gap-1.5 cursor-pointer text-xs text-brand-muted" title="Shade the periods a reading was in warning or alarm">
							<input type="checkbox" bind:checked={showAlarmBands} /> Alarm bands
						</label>
						<label class="flex items-center gap-1.5 cursor-pointer text-xs text-brand-muted" title="Colour the time axis by which sensor was deployed">
							<input type="checkbox" bind:checked={showSensorVectors} /> Sensor bands
						</label>
						<label class="flex items-center gap-1.5 cursor-pointer text-xs text-brand-muted" title="Mark calibration changes">
							<input type="checkbox" bind:checked={showCalibrationMarkers} /> Calibration markers
						</label>
						<label
							class="flex items-center gap-1.5 text-xs {chartResolution === 'raw' ? 'text-brand-muted/50 cursor-not-allowed' : 'text-brand-muted cursor-pointer'}"
							title={chartResolution === 'raw'
								? 'Raw readings carry no sensor dimension; choose an aggregate resolution'
								: 'One line per instrument instead of the count-weighted merge'}
						>
							<input
								type="checkbox"
								bind:checked={splitBySensor}
								disabled={chartResolution === 'raw'}
								onchange={scheduleFetch}
							/> Split by instrument
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

						<span data-testid="chart-window-label" class="text-xs text-brand-muted ml-auto font-mono">
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
							decimals={sp.decimal_places}
							isDerived={sp.entry_mode === 'tool'}
							externalSource={paramExtents.get(sp.id)?.external_source ?? null}
							threshold={th}
							annotations={annotationsByParam.get(sp.parameter_id) ?? []}
							seriesIndex={i}
							syncKey={cursorSyncKey}
							chartData={chartDataMap.get(sp.id) ?? null}
							spotData={spotDataMap.get(sp.id) ?? null}
							spotStats={spotStatsMap.get(sp.parameter_id) ?? null}
							{showReplicates}
							sdEstimator={sdEstimatorFor(sp.parameter_id)}
							withdrawnCount={withdrawnCounts.get(sp.parameter_id) ?? 0}
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
							originLabel={originLabels.get(sp.id) ?? ''}
							extraSeries={sensorSplitMap.get(sp.id) ?? []}
							primarySeriesLabel={firstSensorLabels.get(sp.id) ?? null}
							emptyMessage={emptyMessageFor(sp.id)}
							exactTimes={chartResolution === 'raw'}
							onpointclick={(p) => pinInspector(sp, param.name, p)}
						/>
						{#if inspector?.siteParameterId === sp.id}
							<PointInspector
								siteId={siteId}
								parameterId={sp.parameter_id}
								parameterName={param.name}
								units={unitsForParameter(sp.parameter_id)}
								decimals={sp.decimal_places}
								timeIso={inspector.timeIso}
								measurementType={inspector.measurementType}
								revision={inspectorRevision}
								link={chartPointLink(inspector)}
								onclose={() => (inspector = null)}
								onflag={(reps) => openChartFlag(sp, param.name, reps)}
							/>
						{/if}
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
										decimals={sp.decimal_places}
										threshold={th}
										annotations={annotationsByParam.get(sp.parameter_id) ?? []}
										seriesIndex={measurementParams.length + i}
										syncKey={cursorSyncKey}
										chartData={chartDataMap.get(sp.id) ?? null}
										spotData={spotDataMap.get(sp.id) ?? null}
										spotStats={spotStatsMap.get(sp.parameter_id) ?? null}
										{showReplicates}
										sdEstimator={sdEstimatorFor(sp.parameter_id)}
										withdrawnCount={withdrawnCounts.get(sp.parameter_id) ?? 0}
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
										originLabel={originLabels.get(sp.id) ?? ''}
							extraSeries={sensorSplitMap.get(sp.id) ?? []}
							primarySeriesLabel={firstSensorLabels.get(sp.id) ?? null}
										emptyMessage={emptyMessageFor(sp.id)}
										exactTimes={chartResolution === 'raw'}
										onpointclick={(p) => pinInspector(sp, param.name, p)}
									/>
									{#if inspector?.siteParameterId === sp.id}
										<PointInspector
											siteId={siteId}
											parameterId={sp.parameter_id}
											parameterName={param.name}
											units={unitsForParameter(sp.parameter_id)}
											timeIso={inspector.timeIso}
											measurementType={inspector.measurementType}
											revision={inspectorRevision}
											link={chartPointLink(inspector)}
											onclose={() => (inspector = null)}
											onflag={(reps) => openChartFlag(sp, param.name, reps)}
										/>
									{/if}
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
					<span class="text-sm font-semibold">
						Parameters ({siteParameters.length})
						{#if siteParameters.some((sp) => sp.needs_review)}
							<span class="ml-2 rounded bg-severity-warning-soft px-1.5 py-0.5 text-xs font-medium text-severity-warning-text" title="Added by a tool save, awaiting confirmation">
								{siteParameters.filter((sp) => sp.needs_review).length} need review
							</span>
						{/if}
					</span>
					<div class="flex items-center gap-2">
						<Button
							size="sm"
							onclick={() => { showApplyGroup = !showApplyGroup; showAddParameter = false; }}
						>{showApplyGroup ? 'Cancel' : 'Apply group'}</Button>
						<Button
							size="sm"
							onclick={() => { showAddParameter = !showAddParameter; showApplyGroup = false; }}
						>{showAddParameter ? 'Cancel' : 'Add'}</Button>
					</div>
				</div>

				{#if showApplyGroup}
					<div class="p-4 border-b border-brand-divider bg-brand-bg/50 space-y-2">
						<p class="text-xs text-brand-muted">A group brings in everything it holds: the parameters entered at a visit and the ones its calculations publish. Parameters the site already carries are left as they are.</p>
						<div class="flex items-end gap-3">
							<div class="flex-1">
								<label for="apply-group-select" class="text-xs font-medium block mb-1">Parameter group</label>
								<select id="apply-group-select" bind:value={applyGroupId} class="w-full px-3 py-1.5 text-sm border border-brand-divider rounded bg-brand-surface">
									<option value="">Select a group…</option>
									{#each parameterGroups as g}
										<option value={g.id}>{g.label} ({g.code})</option>
									{/each}
								</select>
							</div>
							<Button
								variant="primary"
								size="sm"
								onclick={applyGroup}
								disabled={!applyGroupId || applyingGroup}
							>{applyingGroup ? 'Applying…' : 'Apply'}</Button>
						</div>
					</div>
				{/if}

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
						<th class="text-left px-4 py-2 font-semibold">Channel</th>
						<th class="text-left px-4 py-2 font-semibold">Decimals</th>
						<th class="text-left px-4 py-2 font-semibold">Instrument</th>
						<th class="text-left px-4 py-2 font-semibold">Warning</th>
						<th class="text-left px-4 py-2 font-semibold">Alarm</th>
						<th class="text-left px-4 py-2 font-semibold">Active</th>
						<th class="text-right px-4 py-2 font-semibold">Actions</th>
					</tr></thead>
					<tbody>
						{#each slotGroups as slotGroup (slotGroup.id ?? 'ungrouped')}
							{@const key = slotGroup.id ?? 'ungrouped'}
							{@const collapsed = collapsedGroups.includes(key)}
							<tr class="border-b border-brand-divider bg-brand-bg/60">
								<td colspan="11" class="px-4 py-2">
									<button
										type="button"
										class="inline-flex items-center gap-2 text-sm font-semibold"
										aria-expanded={!collapsed}
										onclick={() => toggleGroup(key)}
									>
										<span class="text-brand-muted" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
										{slotGroup.label}
										{#if slotGroup.code}<span class="font-mono text-xs font-normal text-brand-muted">{slotGroup.code}</span>{/if}
										<span class="text-xs font-normal text-brand-muted">{slotGroup.slots.length} parameter{slotGroup.slots.length === 1 ? '' : 's'}</span>
									</button>
									{#if slotGroup.declared.length > 0}
										<span class="ml-2 text-xs text-brand-muted">Declared here:</span>
										{#each slotGroup.declared as calculation}
											<CalculationChip {calculation} />
										{/each}
									{/if}
								</td>
							</tr>
							{#if !collapsed}
								{#each slotGroup.slots as sp}
								{@const th = effectiveThreshold(sp.parameter_id)}
								{@const disabled = th != null && isThresholdDisabled(th)}
								{@const warn = th && !disabled ? formatThresholdRange(th.warning_min, th.warning_max, paramUnits(sp)) : null}
								{@const alarm = th && !disabled ? formatThresholdRange(th.alarm_min, th.alarm_max, paramUnits(sp)) : null}
								<tr class="border-b border-brand-divider last:border-b-0">
									<td class="px-4 py-2 font-mono text-xs">{paramCode(sp.parameter_id)}</td>
									<td class="px-4 py-2 font-semibold">
										{paramName(sp.parameter_id)}
										{#if sp.needs_review}
											<span class="ml-1 rounded bg-severity-warning-soft px-1.5 py-0.5 text-xs font-medium text-severity-warning-text" title="Added by a tool save, awaiting confirmation">Needs review</span>
										{/if}
										{#each slotCalculations.get(sp.parameter_id) ?? [] as calculation}
											<CalculationChip {calculation} />
										{/each}
									</td>
									<td class="px-4 py-2">
										<input
											class="w-24 rounded-md border border-brand-divider bg-brand-surface px-2 py-1 text-xs"
											title="Overrides the parameter's default units at this site"
											aria-label="Display units for {paramName(sp.parameter_id)}"
											placeholder={parameters.find((p) => p.id === sp.parameter_id)?.default_units ?? ''}
											value={sp.display_units ?? ''}
											onchange={(e) => updateSlot(sp, { display_units: e.currentTarget.value.trim() || null }, 'units')}
										/>
									</td>
									<td class="px-4 py-2">
										<input
											type="number"
											min="0"
											class="w-24 rounded-md border border-brand-divider bg-brand-surface px-2 py-1 text-xs"
											title="Expected seconds between readings"
											aria-label="Sample interval in seconds for {paramName(sp.parameter_id)}"
											placeholder="None"
											value={sp.sample_interval_sec ?? ''}
											onchange={(e) => {
												const v = slotNumber(e.currentTarget.value);
												if (v !== undefined) updateSlot(sp, { sample_interval_sec: v }, 'sample interval');
											}}
										/>
									</td>
									<td class="px-4 py-2">
										<input
											type="number"
											class="w-20 rounded-md border border-brand-divider bg-brand-surface px-2 py-1 text-xs"
											title="The channel identifier this slot carries in its source system"
											aria-label="Channel identifier for {paramName(sp.parameter_id)}"
											placeholder="None"
											value={sp.channel_id ?? ''}
											onchange={(e) => {
												const v = slotNumber(e.currentTarget.value);
												if (v !== undefined) updateSlot(sp, { channel_id: v }, 'channel');
											}}
										/>
									</td>
									<td class="px-4 py-2">
										<input
											type="number"
											min="0"
											max="10"
											class="w-16 rounded-md border border-brand-divider bg-brand-surface px-2 py-1 text-xs"
											title="How many decimal places this slot is shown and published at. Stored readings keep their full precision either way."
											aria-label="Decimal places for {paramName(sp.parameter_id)}"
											placeholder="Default"
											value={sp.decimal_places ?? ''}
											onchange={(e) => {
												const v = slotNumber(e.currentTarget.value);
												if (v !== undefined) updateSlot(sp, { decimal_places: v }, 'decimal places');
											}}
										/>
									</td>
									<td class="px-4 py-2">
										<select
											class="rounded-md border border-brand-divider bg-brand-surface px-2 py-1 text-xs"
											title="What measures this parameter here. A value entered or calculated at this site names it; undeclared leaves the entry channel's own marker."
											aria-label="Instrument for {paramName(sp.parameter_id)}"
											value={sp.instrument_sensor_id ?? ''}
											onchange={(e) => declareInstrument(sp, e.currentTarget.value)}
										>
											<option value="">Undeclared</option>
											{#each sensors as sensor}
												<option value={sensor.id}>{sensor.name}</option>
											{/each}
										</select>
									</td>
									{#if disabled}
										<td class="px-4 py-2 text-xs text-brand-muted italic" colspan="2">Disabled</td>
									{:else}
										<td class="px-4 py-2 text-xs text-severity-warning">{#if warn}{warn}{:else}<span class="text-brand-muted">None</span>{/if}</td>
										<td class="px-4 py-2 text-xs text-severity-alarm">{#if alarm}{alarm}{:else}<span class="text-brand-muted">None</span>{/if}</td>
									{/if}
									<td class="px-4 py-2">
										<input
											type="checkbox"
											title="A retired slot keeps its readings and its configuration, and stops being alarmed on or listed as a place this parameter is measured"
											aria-label="Active at this site: {paramName(sp.parameter_id)}"
											checked={sp.is_active ?? false}
											onchange={(e) => updateSlot(sp, { is_active: e.currentTarget.checked }, e.currentTarget.checked ? 'active' : 'retired')}
										/>
									</td>
									<td class="px-4 py-2 text-right space-x-1">
										<ConfirmSiteParameterButton
											siteParameter={sp}
											label={paramName(sp.parameter_id)}
											onconfirmed={reloadSiteParameters}
										/>
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
							{/if}
						{/each}
						{#if siteParameters.length === 0}
							<tr><td colspan="11" class="px-4 py-6 text-center text-brand-muted">No parameters configured</td></tr>
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
									{@const sp = siteParameters.find((s) => s.parameter_id === d.output_parameter_id && s.entry_mode === 'tool')}
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
									{#if cal}<span class="font-mono">{formatEquation(cal.slope, cal.intercept)}</span> <span class="text-brand-muted text-xs">({formatRelativeTime(cal.valid_from)})</span>{:else}<span class="text-brand-muted">None</span>{/if}
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
													<span class="ml-auto font-mono">{formatEquation(c.slope, c.intercept)}</span>
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
				{#if samplesLoading}
					<p class="text-sm text-brand-muted">Loading samples…</p>
				{:else if samples.length === 0}
					<p class="text-sm text-brand-muted">
						No replicate groups recorded for this site. A measurement taken once is listed
						under Visits, with the record of what produced it.
					</p>
				{:else}
					<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
						<table class="w-full text-sm">
							<thead><tr class="bg-brand-bg border-b border-brand-divider">
								<th class="text-left px-4 py-2 font-semibold">Time</th>
								<th class="text-left px-4 py-2 font-semibold">Parameter</th>
								<th class="text-right px-4 py-2 font-semibold">Mean</th>
								<th class="text-right px-4 py-2 font-semibold">Stdev</th>
								<th class="text-right px-4 py-2 font-semibold">N</th>
								<th class="text-right px-4 py-2 font-semibold">Min</th>
								<th class="text-right px-4 py-2 font-semibold">Max</th>
								<th class="text-left px-4 py-2 font-semibold">Standard curve</th>
							</tr></thead>
							<tbody>
								{#each samples as s}
									<tr class="border-b border-brand-divider last:border-b-0">
										<td class="px-4 py-2 text-xs">{formatDateTime(s.collected_at)}</td>
										<td class="px-4 py-2">
											{paramName(s.parameter_id)}
											{#if unitsForParameter(s.parameter_id)}<span class="text-brand-muted">({unitsForParameter(s.parameter_id)})</span>{/if}
										</td>
										<td class="px-4 py-2 text-right font-mono">{formatMeasurement(s.mean, decimalsForParameter(s.parameter_id))}</td>
										<td class="px-4 py-2 text-right font-mono">{formatMeasurement(s.stdev, decimalsForParameter(s.parameter_id))}</td>
										<td class="px-4 py-2 text-right font-mono">{s.n}</td>
										<td class="px-4 py-2 text-right font-mono">{formatMeasurement(s.min_value, decimalsForParameter(s.parameter_id))}</td>
										<td class="px-4 py-2 text-right font-mono">{formatMeasurement(s.max_value, decimalsForParameter(s.parameter_id))}</td>
										<td class="px-4 py-2 text-xs">
											{#if !sampleCurves.has(s.id)}
												<span class="text-brand-muted" title="Curve references load with the charts; this sample falls outside the selected time range.">Not loaded</span>
											{:else if sampleCurves.get(s.id)?.mixed}
												<span class="text-brand-muted">Mixed</span>
											{:else if sampleCurves.get(s.id)?.curveId}
												{@const sc = sampleCurves.get(s.id)!}
												{@const curveId = sc.curveId!}
												{@const sensorId = curveRefs.standardCurveSensorId(curveId)}
												{@const equation = curveRefs.standardCurveEquation(curveId)}
												{@const corrected = sc.replicates.filter((r) => r.calibrated_value != null)}
												{#if sensorId}
													<a href="{base}/sensors/{sensorId}?tab=curves&curve={curveId}" class="text-brand-primary hover:underline">{curveRefs.standardCurveLabel(curveId)}</a>
												{:else}
													{curveRefs.standardCurveLabel(curveId)}
												{/if}
												{#if equation}
													<div class="font-mono text-brand-muted">{equation}</div>
												{/if}
												{#if corrected.length > 0}
													<div class="font-mono text-brand-muted" title="Raw values and the corrected values served from them">
														{corrected.map((r) => r.raw_value).join(', ')} → {corrected.map((r) => r.calibrated_value).join(', ')}
													</div>
												{/if}
											{:else}
												<span class="text-brand-muted">None</span>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					<PaginationControls
						total={samplesTotal}
						page={samplesPage}
						perPage={SAMPLES_PER_PAGE}
						onPageChange={(p) => { samplesPage = p; loadSamples(); }}
					/>
				{/if}
			</div>

		<!-- Sensor vs grab: each grab value against the continuous average just after it -->
		{:else if activeKey === 'comparison'}
			<SensorVsGrabPanel
				siteId={site?.id ?? ''}
				parameters={comparisonParameters}
			/>

		<!-- Visits tab: the portal's wide data row, one per field date -->
		{:else if activeKey === 'visits'}
			<SiteVisitsTab
				{siteId}
				siteName={site?.name ?? null}
				{siteParameters}
				active={activeKey === 'visits'}
				{paramName}
				{unitsForParameter}
				{decimalsForParameter}
				{visitPointLink}
				onFlag={(t) => { flagTarget = t; flagOpen = true; }}
				onDataChanged={scheduleFetch}
			/>

		<!-- Status tab (admin-only) -->
		{:else if activeKey === 'status'}
			<SiteStatusTab {siteId} active={activeKey === 'status'} {paramName} />

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
	<SiteExportDialog
		bind:open={exportOpen}
		{siteId}
		siteName={site?.name ?? null}
		{siteParameters}
		rangeStartMs={chartStart}
		rangeEndMs={chartEnd}
		sliderMinMs={sliderMin}
		sliderMaxMs={sliderMax}
		{paramName}
		{paramCode}
	/>

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
				candidates={siteParameters.filter((s) => s.entry_mode !== 'tool').map((s) => ({ id: s.id, label: paramName(s.parameter_id) }))}
				onsuccess={reloadSiteParameters}
			/>
		{/if}

		{#if flagOpen && flagTarget}
			<ReplicateFlagDialog
				bind:open={flagOpen}
				siteId={site.id}
				parameterId={flagTarget.parameterId}
				parameterName={flagTarget.parameterName}
				units={unitsForParameter(flagTarget.parameterId)}
				decimals={decimalsForParameter(flagTarget.parameterId)}
				timeIso={flagTarget.timeIso}
				replicates={flagTarget.replicates}
				onsuccess={flagTarget.onSaved}
			/>
		{/if}
	{/if}
{/if}
