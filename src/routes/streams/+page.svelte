<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { base } from '$app/paths';
	import { beforeNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ApiError } from '$api/client';
	import { api, type DataStream, type SiteParameter, type Site, type Parameter } from '$api/crud';
	import {
		pairStream, unpairStream, getStreamStats, listStreamReceipts, retagStreams, createPairingPlan, updatePairingPlan,
		applyPairingPlan, revertPairingPlan, getUnpairedSummary, getPlanSiteMetadata,
		replicateSpec, getPendingAuditSummary, getStreamPreview,
		getPlanInstruments, listPairingPlans, supersedePairingPlan, getPairingPlan, bulkUpdatePairingPlan,
		type PairingPlan, type PairingPlanEntry, type PlanEntryUpdate, type PairingPlanApplyResult, type StreamStats, type SiteMetadata,
		type PlanReplicateSummary, type StreamReceipt, type PlanWarning, type PlanInstrumentRef,
		type PlanInstruments, type PlanInstrumentGroup, type PlanDeviceGroup, type PlanCurveAssignment,
		type PairingPlanListing,
	type StreamPreview,
	} from '$api/service';
	import { issueSyncCommand, type SyncService } from '$api/service';
	import { getList } from '$api/client';
	import { resyncConfirmation, resyncServiceFor } from '$lib/sync/resync';
	import { me } from '$auth/me.svelte';
	import {
		siteGroups as planSiteGroups,
		instrumentGroups as planInstrumentGroups,
		familySummary as planFamilySummary,
		paramGroups as planParamGroups,
		parameterIndex,
		instrumentBindings as planInstrumentBindings,
		type InstrumentDecision,
		isAskingInstrument,
		suggestionAcceptance,
		creations,
		type ParamGroup,
		type GroupCreation,
		type SiteCreation,
		type SiteGroup,
	} from '$lib/pairing/planGroups';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatRelativeTime, holdKindBreakdown } from '$lib/utils';
	import { createUrlTab } from '$lib/urlTab.svelte';
	import { createDraftQueue } from '$lib/pairing/draftQueue';
	import { splitPlanUpdates, type PlanUpdate } from '$lib/pairing/planUpdates';
	import { NO_PLAN_RUNS, runsAfterJob, type PlanRuns } from '$lib/pairing/planRuns';
	import { eventBus } from '$lib/stores/events.svelte';
	import { entryStatus, matchesFilter, reviewState, reviewStateLabel, statusLabel, type EntryFilter } from '$lib/pairing/entryStatus';
	import {
		acceptHint,
		entriesSettledBy,
		objectDecisions,
		type ObjectDecision,
	} from '$lib/pairing/objectDecisions';
	import { activeReviewTab, objectsTabLabel, type ReviewTab } from '$lib/pairing/reviewTabs';
	import PairSkipToggle from '$components/ui/PairSkipToggle.svelte';
	import MappingSelect, { type MappingGroup } from '$components/ui/MappingSelect.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import StreamBrake from '$components/streams/StreamBrake.svelte';
	import { formatClockTime, formatDateTime, formatSignificant } from '$lib/utils';
	import Button from '$components/ui/Button.svelte';
	import Tabs from '$components/ui/Tabs.svelte';
	import ReplicateFamilyBadge from '$components/streams/ReplicateFamilyBadge.svelte';
	import ChangeProposalsPanel from '$components/logs/ChangeProposalsPanel.svelte';
	import ReplicateAuditsPanel from '$components/logs/ReplicateAuditsPanel.svelte';
	import DiscrepancyBrowse from '$components/logs/DiscrepancyBrowse.svelte';
	import { readTagParams } from '$lib/discrepancies';
	import { AUDIT_QUEUE_KINDS } from '$lib/holds';
	import InstrumentCurvesPanel from '$components/streams/InstrumentCurvesPanel.svelte';
	import { formatCount } from '$lib/format';
	import ConfirmStep from '$components/pairing/ConfirmStep.svelte';
	import ApplyResults from '$components/pairing/ApplyResults.svelte';
	import CurvesTab from '$components/pairing/CurvesTab.svelte';
	import InstrumentsTab from '$components/pairing/InstrumentsTab.svelte';
	import ParametersTab, { PARAM_ROWS_PER_PAGE } from '$components/pairing/ParametersTab.svelte';
	import { gateBlocking, planGateItems, type GateItem } from '$lib/pairing/applyGate';
	import SitesTab from '$components/pairing/SitesTab.svelte';
	import {
		clearSelection,
		emptySelection,
		prune,
		selectAllInFilter,
		selectEntries,
		toggle as toggleSelected,
		type Selection,
	} from '$lib/pairing/selection';
	import { bulkUpdates, type BulkDecision } from '$lib/pairing/bulkActions';

	// ── Stream list state ──
	let streams = $state<DataStream[]>([]);
	let siteParams = $state<SiteParameter[]>([]);
	let sites = $state<Site[]>([]);
	let params = $state<Parameter[]>([]);
	let total = $state(0);
	let loading = $state(true);
	// The source audit links here with the source it just audited and the rows it flagged, so both
	// are read from the URL rather than reset to the page's own defaults.
	const linkedSource = page.url.searchParams.get('source');
	let listFilter = $state<'all' | 'paired' | 'unpaired'>(
		(page.url.searchParams.get('list_filter') as 'all' | 'paired' | 'unpaired') ?? 'all',
	);
	let currentPage = $state(1);
	const perPage = 25;
	const totalPages = $derived(Math.ceil(total / perPage));
	let error = $state<string | null>(null);
	let searchQuery = $state(page.url.searchParams.get('q') ?? '');
	let sortField = $state('source_key');
	let sortOrder = $state<'ASC' | 'DESC'>('ASC');

	// Source-system facet (counts per source), used to drive the filter chips.
	// "Non-instrument" sources (CSV/batch + manual grab samples) start excluded so the
	// default view shows real device streams, not ingestion noise.
	const NON_INSTRUMENT_SOURCES = ['api', 'grab_sample'];
	let sourceSummary = $state<Array<{ source_system: string; unpaired: number; paired: number }>>([]);
	let selectedSources = $state<Set<string>>(new Set());
	let sourcesInitialized = $state(false);
	const allSourceSystems = $derived(sourceSummary.map((s) => s.source_system));

	// Replicate-sync surfacing: withheld audit groups banner.
	let pendingAudits = $state(0);
	// Values the source has changed and nobody has ruled on. Counted beside the holds because the
	// tab is one queue to the person working it.
	let pendingProposals = $state(0);
	// The queue carries six kinds; naming them keeps a fired brake from reading as a statistics
	// disagreement without opening the tab.
	let pendingByKind = $state<Record<string, number>>({});
	const auditBreakdown = $derived(holdKindBreakdown(pendingByKind));
	// The list mode is a two-tab hub: the streams table and the replicate-audit holds.
	// The audit surface is manager-only; below that level the page is the streams table alone.
	const canAudit = $derived(me.can('manageSensors'));
	const tab = createUrlTab({ keys: ['streams', 'audits', 'discrepancies', 'instruments'] });
	const auditQueue = $derived(pendingAudits + pendingProposals);
	const tabLabels = $derived(
		canAudit
			? ['Streams', auditQueue > 0 ? `Audits (${auditQueue})` : 'Audits', 'Discrepancies', 'Instruments']
			: ['Streams'],
	);
	// Expanded replicate-routing blocks in the plan review, keyed by stream id or `param:{name}`.
	let expandedReplicates = $state<Set<string>>(new Set());
	// The stream's own recent rows, fetched once per stream when a routing block is first opened.
	// A mapping and an example of that mapping applied are different things, and the second is the
	// one that tells an operator whether the pairing is right.
	let previews = $state<Map<string, StreamPreview | 'loading' | 'failed'>>(new Map());

	function toggleReplicateExpand(key: string, streamId?: string) {
		const next = new Set(expandedReplicates);
		if (next.has(key)) next.delete(key);
		else {
			next.add(key);
			if (streamId) void loadPreview(streamId);
		}
		expandedReplicates = next;
	}

	async function loadPreview(streamId: string) {
		if (previews.has(streamId)) return;
		previews = new Map(previews).set(streamId, 'loading');
		try {
			const preview = await getStreamPreview(streamId, 3);
			previews = new Map(previews).set(streamId, preview);
		} catch {
			previews = new Map(previews).set(streamId, 'failed');
		}
	}

	async function loadReplicateSurfacing() {
		if (canAudit) {
			try {
				const summary = await getPendingAuditSummary(AUDIT_QUEUE_KINDS);
				pendingAudits = summary.pending;
				pendingByKind = summary.byKind;
			} catch { /* banner is best-effort */ }
		}
	}

	// ── Manual pair dialog ──
	let pairDialogOpen = $state(false);
	let pairStream_ = $state<DataStream | null>(null);
	let selectedSiteParam = $state('');
	let pairing = $state(false);

	// ── Stats dialog ──
	let statsDialogOpen = $state(false);
	let statsStream = $state<DataStream | null>(null);
	let stats = $state<StreamStats | null>(null);
	let receipts = $state<StreamReceipt[] | null>(null);

	// ── Plan wizard state (URL-driven for browser back/forward) ──
	type WizardMode = 'list' | 'source-select' | 'review' | 'confirm' | 'results';
	const mode = $derived<WizardMode>((page.url.searchParams.get('step') as WizardMode) || 'list');

	function setMode(newMode: WizardMode) {
		if (mode === 'review' && newMode !== 'review') void flushUpdates();
		const url = new URL(page.url);
		if (newMode === 'list') {
			url.searchParams.delete('step');
		} else {
			url.searchParams.set('step', newMode);
		}
		// The review's position belongs to the review; carrying it onto the streams list would
		// collide with that list's own paging.
		if (newMode !== 'review') {
			for (const name of ['review_tab', 'filter', 'q', 'page']) url.searchParams.delete(name);
		}
		if (newMode === 'list') url.searchParams.delete('plan');
		goto(url.toString(), { replaceState: false, noScroll: true });
	}
	let unpairedSummary = $state<Array<{ source_system: string; unpaired: number; paired: number }>>([]);
	let plan = $state<PairingPlan | null>(null);
	let planEntries = $state<PairingPlanEntry[]>([]);
	let applyResult = $state<PairingPlanApplyResult | null>(null);
	let planLoading = $state(false);
	let applying = $state(false);
	// The apply and revert this tab started, so their plan's row says so while the job runs and
	// stops saying so when it finishes.
	let planRuns = $state<PlanRuns>({ ...NO_PLAN_RUNS });
	const applyJobId = $derived(planRuns.applyJobId);
	const applyingPlanId = $derived(planRuns.applyingPlanId);
	const revertingPlanId = $derived(planRuns.revertingPlanId);
	// Plans already applied, per source system: the way back to the counts of a run nobody watched.
	let appliedPlans = $state<PairingPlanListing[]>([]);
	let reverting = $state(false);
	let saving = $state(false);
	// What the header reports about the draft: the last batch that reached the server, and whether
	// one was refused. A refusal is dropped from the queue, so without this the count returns to
	// zero and the page reads as saved.
	let lastSavedAt = $state<Date | null>(null);
	let saveRefused = $state(false);

	// ── Plan review controls ──
	// The review's own position is in the URL, so a reload lands on the same tab, page and filter
	// rather than at the top of a 1891-entry plan.
	const reviewParam = (name: string) => page.url.searchParams.get(name);
	let siteSearch = $state(reviewParam('q') ?? '');
	let reviewFilter = $state<EntryFilter>((reviewParam('filter') as EntryFilter) ?? 'all');
	/** The rows a bulk action is about. Kept beside the plan so a tab change does not lose it. */
	let planSelection = $state<Selection>(emptySelection);
	let expandedSites = $state<Set<string>>(new Set());
	let editingSite = $state<string | null>(null);
	let editingParam = $state<{ site: string; streamId: string } | null>(null);
	let editingGlobalParam = $state<string | null>(null);
	let editValue = $state('');
	let customParamInput = $state<string | null>(null);
	let expandedParamGroups = $state<Set<string>>(new Set());
	let splitParamInput = $state<{ groupName: string; sourceName: string } | null>(null);
	let splitParamValue = $state('');
	// The page of parameter rows on show, held here so goToParam can turn to the row it wants.
	let paramPage = $state(0);
	let sitePage = $state(Math.max(0, Number(reviewParam('page') ?? '1') - 1) || 0);
	const sitesPerPage = 50;
	// Objects first: the handful of projects, sites and parameters the plan creates is the
	// decision behind most rows. Parameters is the cross-site editor after that, where every
	// naming, units and instrument decision is made once rather than 31 times in Sites.
	// `null` is a review nobody has clicked a tab on, which `activeReviewTab` opens for them.
	let reviewTab = $state<ReviewTab | null>((reviewParam('review_tab') as ReviewTab) ?? null);
	// The plan's instrument picture, including instruments the source registered that this plan
	// binds to nothing. Refetched after every instrument edit, since an attach moves a whole scope.
	let planInstruments = $state<PlanInstruments | null>(null);

	// The review's position follows the controls into the URL. Only while the review is open: on
	// every other step these params are noise.
	$effect(() => {
		const tab = reviewTab;
		const filter = reviewFilter;
		const search = siteSearch;
		const pageNo = sitePage;
		const planId = plan?.id;
		untrack(() => {
			if (mode !== 'review') return;
			const url = new URL(page.url);
			const set = (name: string, value: string, fallback: string) => {
				if (value === fallback) url.searchParams.delete(name);
				else url.searchParams.set(name, value);
			};
			if (planId) url.searchParams.set('plan', planId);
			set('review_tab', tab ?? '', '');
			set('filter', filter, 'all');
			set('q', search.trim(), '');
			set('page', String(pageNo + 1), '1');
			if (url.toString() !== page.url.toString()) {
				goto(url, { replaceState: true, noScroll: true });
			}
		});
	});

	const siteGroups = $derived(planSiteGroups(planEntries));

	const filteredGroups = $derived.by(() => {
		let groups = siteGroups;
		if (siteSearch.trim()) {
			const q = siteSearch.toLowerCase();
			groups = groups.filter((g) => g.siteName.toLowerCase().includes(q));
		}
		if (reviewFilter === 'pair') groups = groups.filter((g) => g.pairCount > 0);
		else if (reviewFilter === 'skip') groups = groups.filter((g) => g.skipCount === g.entries.length);
		else if (reviewFilter !== 'all') {
			// Unmatched and with-warnings read the entry's own status, the same predicate the row
			// renders its legend from, so a filtered list and the badges on it cannot disagree.
			groups = groups.filter((g) => g.entries.some((e) => matchesFilter(e, reviewFilter)));
		}
		return groups;
	});

	// What share of the plan still wants a person, over the entries it would pair. Read from the
	// entries so it follows an unsaved tick, and rounded the same way in both chips.
	const reviewProgress = $derived.by(() => {
		const pairing = planEntries.filter((e) => e.action === 'pair');
		const counts = { needs_checking: 0, self_validated: 0, acknowledged: 0 };
		for (const e of pairing) counts[reviewState(e)]++;
		const pct = (n: number) => (pairing.length === 0 ? 0 : Math.round((n / pairing.length) * 100));
		return {
			total: pairing.length,
			...counts,
			needsCheckingPct: pct(counts.needs_checking),
			selfValidatedPct: pct(counts.self_validated),
		};
	});

	const pagedGroups = $derived(filteredGroups.slice(sitePage * sitesPerPage, (sitePage + 1) * sitesPerPage));
	const totalSitePages = $derived(Math.ceil(filteredGroups.length / sitesPerPage));

	const summary = $derived.by(() => {
		let toPair = 0, toSkip = 0, warnings = 0;
		const newSites = new Set<string>();
		const newParams = new Set<string>();
		const newProjects = new Set<string>();
		for (const e of planEntries) {
			if (e.action === 'pair') toPair++; else toSkip++;
			if (e.warnings.length) warnings += e.warnings.length;
			if (e.action === 'pair') {
				if (e.site.create) newSites.add(e.site.name);
				if (e.parameter.create) newParams.add(e.parameter.name);
				if (e.project.create) newProjects.add(e.project.name);
			}
		}
		return { toPair, toSkip, total: planEntries.length, warnings, newSites: newSites.size, newParams: newParams.size, newProjects: newProjects.size };
	});

	const instrumentGroups = $derived(planInstrumentGroups(planEntries));
	const instrumentBindings = $derived(planInstrumentBindings(planEntries));

	// ── Instrument decisions ──
	// One list, questions first: an instrument the plan has bound and a source parameter still
	// without one are the same decision at two stages, so they are edited in one place and only
	// mirrored elsewhere. Which way the list is grouped comes from the server: a portal source
	// groups by parameter or curve column, a source that identifies its hardware by serial reports
	// devices instead, and those are not questions at all.
	const instrumentDecisions = $derived.by((): InstrumentDecision[] => {
		const rows: InstrumentDecision[] = [];
		for (const u of planInstruments?.unassigned ?? []) {
			rows.push({
				key: u.scope,
				scope: u.scope,
				name: u.suggested_name,
				proposedName: u.suggested_name,
				nameConflict: u.name_conflict ?? null,
				group: null,
				parameters: [u.parameter],
				siteCount: u.site_count,
				streamCount: u.stream_count,
				anchorStreamId: u.anchor_stream_id,
			});
		}
		for (const g of planInstruments?.groups ?? []) {
			if (!g.anchor_stream_id) continue;
			rows.push({
				key: g.scope ?? g.source_key ?? g.name,
				scope: g.scope ?? g.parameters[0] ?? g.name,
				name: g.name,
				proposedName: g.proposed_name ?? g.name,
				nameConflict: g.name_conflict ?? null,
				group: g,
				parameters: g.parameters,
				siteCount: g.site_count,
				streamCount: g.stream_count,
				anchorStreamId: g.anchor_stream_id,
			});
		}
		// Anything still asking comes first; the rest by breadth.
		return rows.sort((a, b) => {
			const askA = a.group === null || (a.group.create && !a.group.confirmed) ? 0 : 1;
			const askB = b.group === null || (b.group.create && !b.group.confirmed) ? 0 : 1;
			return askA - askB || b.streamCount - a.streamCount || a.name.localeCompare(b.name);
		});
	});

	const planDevices = $derived<PlanDeviceGroup[]>(planInstruments?.devices ?? []);
	const deviceParameters = $derived(new Set(planDevices.flatMap((d) => d.parameters)));
	function deviceSiteCount(parameter: string): number {
		return new Set(
			planDevices.filter((d) => d.parameters.includes(parameter)).map((d) => d.site),
		).size;
	}
	const openInstrumentQuestions = $derived(
		instrumentDecisions.filter(isAskingInstrument).length,
	);
	// The apply is refused while any of these is open, one step later. Say so here, where they can
	// still be answered, rather than only on the screen that stops.
	const instrumentsTabLabel = $derived(
		openInstrumentQuestions > 0
			? `Instruments (${openInstrumentQuestions} to decide)`
			: `Instruments (${instrumentDecisions.length + planDevices.length})`,
	);

	// Every creation this plan proposes, offered on every row, so two parameters can converge on
	// one new instrument instead of minting one each.
	const proposedInstrumentNames = $derived.by(() => {
		const names = new Set<string>();
		for (const d of instrumentDecisions) {
			if (d.group === null || d.group.create) names.add(d.group?.name ?? d.proposedName);
			if (d.proposedName) names.add(d.proposedName);
		}
		return [...names].sort();
	});

	function instrumentOptions(d: InstrumentDecision): MappingGroup[] {
		const created = new Set(proposedInstrumentNames);
		created.add(d.proposedName);
		return [
			{
				label: 'Will be created',
				options: [...created]
					.filter(Boolean)
					.map((n) => ({ value: `new:${n}`, label: `+ ${n}` })),
			},
			{
				label: 'Existing instruments',
				options: labInstruments.map((s) => ({
					value: `db:${s.id}`,
					label: s.name ?? s.serial_number ?? s.id,
				})),
			},
		];
	}

	function instrumentValue(d: InstrumentDecision): string {
		if (d.group?.instrument_id) return `db:${d.group.instrument_id}`;
		if (d.group) return `new:${d.group.name}`;
		return '';
	}

	// What the apply will do, which is `create`, not whether a row happens to carry an id: existing
	// means the inventory already holds it, new means this plan mints it.
	function instrumentStatus(d: InstrumentDecision): 'existing' | 'new' | 'unset' {
		if (!d.group) return 'unset';
		return d.group.create ? 'new' : 'existing';
	}

	// Every option is a transition: attach an existing instrument, propose a creation (which is
	// also how an attach is undone, since naming one proposes it), or attach nothing.
	function chooseInstrument(d: InstrumentDecision, value: string) {
		if (value === '__custom__') {
			editingInstrument = d.scope;
			instrumentEditValue = d.group?.name ?? d.proposedName;
			return;
		}
		if (value === '') {
			void detachInstrument(d.anchorStreamId);
			return;
		}
		if (value.startsWith('db:')) {
			void repointInstrument(d.anchorStreamId, value.slice(3));
			return;
		}
		if (value.startsWith('new:')) void proposeInstrument(d.anchorStreamId, value.slice(4));
	}

	// An instrument scope carries the source's own key, which may hold spaces ("metalp:chla acid"),
	// and an element id may not. One helper builds the id and reads it back, so they cannot drift.
	const instrumentRowId = (scope: string) => `instrument-row-${scope.replace(/\s+/g, '-')}`;

	// Show a row the reader was sent to: the tab is switched first, so the scroll waits a tick for
	// it to render.
	function flashTo(id: string) {
		setTimeout(() => {
			const row = document.getElementById(id);
			if (!row) return;
			row.scrollIntoView({ behavior: 'smooth', block: 'center' });
			row.classList.add('flash-highlight');
			setTimeout(() => row.classList.remove('flash-highlight'), 1600);
		}, 0);
	}

	function goToInstrument(scope: string) {
		reviewTab = 'instruments';
		flashTo(instrumentRowId(scope));
	}

	const familySummary = $derived(planFamilySummary(planEntries));

	// What the apply will create, as rows. A site is created once and everything measured there
	// inherits where it is, so a wrong coordinate is corrected before the apply, not after.
	const created = $derived(creations(planEntries));

	function correctSiteAttribute(
		site: SiteCreation,
		field: 'latitude' | 'longitude' | 'altitudeM',
		value: number | null,
	) {
		const key = { latitude: 'site_latitude', longitude: 'site_longitude', altitudeM: 'site_altitude_m' }[field];
		queueUpdate([{ stream_id: site.anchorStreamId, [key]: value }]);
		void flushUpdates().catch(() => {
			/* the toast from the failed flush is the signal */
		});
	}

	// A category is one decision behind every column it holds, so the rename goes on any one of
	// them and the server carries it to the rest.
	function renameProposedGroup(group: GroupCreation, field: 'label' | 'description', value: string) {
		const key = field === 'label' ? 'group_label' : 'group_description';
		queueUpdate([{ stream_id: group.anchorStreamId, [key]: value }]);
		void flushUpdates().catch(() => {
			/* the toast from the failed flush is the signal */
		});
	}

	// ── Consolidated parameter view ──
	// One parameter row's status, read from the entries under it by the predicate the site rows
	// and the filters use, so a row's summary cannot disagree with what expanding it shows.
	function groupStatus(pg: ParamGroup) {
		const ids = new Set(pg.streamIds);
		const entries = planEntries.filter((e) => ids.has(e.stream_id));
		return {
			total: entries.length,
			unmatched: entries.filter((e) => matchesFilter(e, 'unmatched')).length,
			warnings: entries.filter((e) => matchesFilter(e, 'warnings')).length,
		};
	}

	const paramGroups = $derived(planParamGroups(planEntries));

	function rowWarnings(pg: ParamGroup): string[] {
		return pg.warnings;
	}

	// One row per distinct warning, carrying the structured warning so the block can offer the
	// resolutions rather than only naming the problem.
	const uniqueWarnings = $derived.by((): Array<{ warning: PlanWarning; paramName: string; count: number; anchorStreamId: string }> => {
		const map = new Map<string, { warning: PlanWarning; paramName: string; count: number; anchorStreamId: string }>();
		for (const e of planEntries) {
			for (const w of e.warnings) {
				const existing = map.get(w.message);
				if (existing) existing.count++;
				else map.set(w.message, { warning: w, paramName: w.parameter ?? e.parameter.name, count: 1, anchorStreamId: e.stream_id });
			}
		}
		return [...map.values()];
	});

	// ── Instrument decisions ──
	// These write through the same debounced PATCH the rest of the review uses; the server
	// applies them to every entry sharing the curve column, so one click settles the whole group.
	async function repointInstrument(streamId: string, sensorId: string) {
		if (!sensorId) return;
		queueUpdate([{ stream_id: streamId, instrument_id: sensorId }]);
		try { await flushUpdates(); } catch { /* as above */ }
		await loadPlanInstruments();
	}

	// One instrument over a selection: the same write the per-row picker makes, queued once per row
	// and flushed together, so a hundred parameters onto three instruments is three actions rather
	// than a hundred. Each row settles every entry sharing its key, as a single choice does.
	async function assignInstrumentToRows(rows: InstrumentDecision[], instrumentId: string) {
		if (rows.length === 0 || !instrumentId) return;
		queueUpdate(
			rows.map((d) => ({ stream_id: d.anchorStreamId, instrument_id: instrumentId })),
		);
		try { await flushUpdates(); } catch { /* the toast from the failed flush is the signal */ }
		await loadPlanInstruments();
	}

	// One decision over the chosen rows: the same writes the per-row controls make, built once and
	// sent as a single PATCH, which the server applies in one transaction. The local entries move
	// with it so the review reads the way the operator just left it rather than waiting on a reload.
	async function applyBulkDecision(decision: BulkDecision) {
		const updates = bulkUpdates(planEntries, planSelection, decision);
		if (updates.length === 0) return;
		for (const update of updates) {
			const entry = planEntries.find((e) => e.stream_id === update.stream_id);
			if (!entry) continue;
			if (update.action != null) entry.action = update.action;
			if (update.acknowledged != null) entry.acknowledged = update.acknowledged;
		}
		planEntries = [...planEntries];
		queueUpdate(updates, { immediate: true });
		try {
			await flushUpdates();
			toastStore.success(`${formatCount(updates.length)} rows updated`);
		} catch { /* the toast from the failed flush is the signal */ }
		if (decision.field === 'instrument_id' || decision.field === 'instrument_clear') {
			await loadPlanInstruments();
		}
	}

	// Detach, the inverse of an attach: the streams keep pairing, they just carry no instrument.
	async function detachInstrument(streamId: string) {
		queueUpdate([{ stream_id: streamId, instrument_clear: true }]);
		try { await flushUpdates(); } catch { /* as above */ }
		await loadPlanInstruments();
	}

	const boundInstruments = $derived(planInstruments?.groups.length ?? 0);

	// The instrument decision for one source parameter, whichever half of the response carries it.
	// A curve column and a bare parameter are the same decision to an operator, so the Parameters
	// tab renders both through one lookup.
	type ParamInstrument = {
		scope: string;
		anchorStreamId: string;
		suggestion: string;
		group: PlanInstrumentGroup | null;
	};
	const instrumentByParameter = $derived.by(() => {
		const map = new Map<string, ParamInstrument>();
		for (const g of planInstruments?.groups ?? []) {
			if (!g.anchor_stream_id) continue;
			for (const p of g.parameters) {
				map.set(p, { scope: g.scope ?? p, anchorStreamId: g.anchor_stream_id, suggestion: g.name, group: g });
			}
		}
		for (const u of planInstruments?.unassigned ?? []) {
			map.set(u.parameter, { scope: u.scope, anchorStreamId: u.anchor_stream_id, suggestion: u.suggested_name, group: null });
		}
		return map;
	});

	// An instrument that exists takes the curve now; one this plan will create takes it when the
	// plan is applied, so the choice is carried on the plan until then.
	const PLAN_INSTRUMENT_PREFIX = 'plan:';
	// The move goes through the draft queue like every other decision on this plan, so a second
	// reviewer's edit reloads the version and the move is reapplied rather than dropped. The queue
	// reports its own failures, so a rejected flush is not toasted twice here.
	async function moveCurveOnPlan(curveId: string, instrumentSourceKey: string | null) {
		draftQueue.enqueue([{ curve_id: curveId, instrument_source_key: instrumentSourceKey }], {
			immediate: true,
		});
		await draftQueue.flush().catch(() => {});
	}

	async function rehomeCurve(curve: PlanCurveAssignment, target: string) {
		if (!target || !plan) return;
		try {
			if (target.startsWith(PLAN_INSTRUMENT_PREFIX)) {
				await moveCurveOnPlan(curve.id, target.slice(PLAN_INSTRUMENT_PREFIX.length));
			} else {
				if (curve.pending_source_key) {
					await moveCurveOnPlan(curve.id, null);
				}
				if (target !== curve.sensor_id) {
					await api.standardCurves.update(curve.id, { sensor_id: target });
				}
			}
			await loadPlanInstruments();
		} catch (e) { toastStore.error(e instanceof Error ? e.message : 'Could not move the curve'); }
	}

	// The instruments this plan will create, one option each however many parameters share one.
	const plannedInstruments = $derived.by(() => {
		const seen = new Map<string, string>();
		for (const g of planInstruments?.groups ?? []) {
			if (g.create && !seen.has(g.source_key)) seen.set(g.source_key, g.name);
		}
		return [...seen.entries()].map(([sourceKey, name]) => ({ sourceKey, name }));
	});

	// Inline edits in the Instruments tab, keyed the same way the parameter cells are: one open
	// editor at a time, Enter commits, Escape abandons.
	let editingInstrument = $state<string | null>(null);
	let editingCurve = $state<string | null>(null);
	let instrumentEditValue = $state('');
	let curveEditValue = $state('');
	let acceptingSuggestions = $state(false);

	// Naming an instrument is what creates it: the plan carries the proposal, the apply mints it,
	// and every stream in the scope moves with it.
	async function proposeInstrument(anchorStreamId: string, name: string) {
		if (!name.trim()) return;
		queueUpdate([{ stream_id: anchorStreamId, instrument_name: name.trim(), instrument_confirmed: true }]);
		try { await flushUpdates(); } catch { /* the toast from the failed flush is the signal */ }
		await loadPlanInstruments();
	}

	// The suggestions as a set: one click rather than one per parameter, each row keeping its own
	// name edit and attach choice after it.
	async function acceptAllSuggestions() {
		const { updates, held } = suggestionAcceptance(instrumentDecisions);
		if (held > 0) {
			toastStore.info(
				`${held} suggestion${held === 1 ? '' : 's'} left for you: the name is already an instrument, so attaching or creating a second one is your call.`,
			);
		}
		if (updates.length === 0) return;
		acceptingSuggestions = true;
		try {
			queueUpdate(updates);
			await flushUpdates();
			await loadPlanInstruments();
		} catch { /* as above */ }
		finally { acceptingSuggestions = false; }
	}

	async function refreshLabInstruments() {
		try {
			const result = await api.sensors.list({ perPage: 500, filter: { is_lab_instrument: true } });
			labInstruments = result.data.map((s) => ({
				id: s.id,
				name: s.name ?? null,
				serial_number: s.serial_number ?? null,
			}));
		} catch { /* the picker keeps the list it has */ }
	}

	// A name the plan carries is a proposal, and naming one is what proposes it. An instrument that
	// already exists is the inventory's: it is renamed on its own page, where what else depends on
	// the name is visible, never as a side effect of editing a plan.
	async function commitInstrumentName(anchorStreamId: string, group: PlanInstrumentGroup | null) {
		const name = instrumentEditValue.trim();
		editingInstrument = null;
		if (!name || name === group?.name) return;
		await proposeInstrument(anchorStreamId, name);
	}

	async function commitCurveName(curveId: string, current: string | null) {
		const name = curveEditValue.trim();
		editingCurve = null;
		if (!name || name === current) return;
		try {
			await api.standardCurves.update(curveId, { name });
			await loadPlanInstruments();
		} catch (e) { toastStore.error(e instanceof Error ? e.message : 'Rename failed'); }
	}

	async function loadPlanInstruments() {
		if (!plan) return;
		try { planInstruments = await getPlanInstruments(plan.id); }
		catch { planInstruments = null; }
	}

	// ── Units-conflict resolutions ──
	// Keeping the catalog's units drops the plan's override so the entry matches the existing
	// parameter as it stands; taking the source's units renames it, which is what makes the apply
	// create a separate parameter rather than redefine one other data already depends on.
	function adoptCatalogUnits(w: { warning: PlanWarning; paramName: string }) {
		const units = w.warning.existing?.units;
		if (!units) return;
		const updates: PlanEntryUpdate[] = [];
		for (const e of planEntries) {
			if (e.parameter.name !== w.paramName || e.parameter.units === units) continue;
			e.parameter.units = units;
			updates.push({ stream_id: e.stream_id, parameter_units: units });
		}
		if (updates.length === 0) return;
		planEntries = [...planEntries];
		queueUpdate(updates);
	}

	function adoptSourceUnits(w: { warning: PlanWarning; paramName: string }) {
		const units = w.warning.source_units;
		if (!units) return;
		const newName = `${w.paramName}_${units.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'alt'}`;
		renameGlobalParam(w.paramName, newName, units);
	}

	function goToParam(paramName: string) {
		reviewTab = 'parameters';
		const at = paramGroups.findIndex((pg) => pg.name === paramName);
		if (at >= 0) paramPage = Math.floor(at / PARAM_ROWS_PER_PAGE);
		flashTo(`param-row-${paramName}`);
	}

	// A site named on the object card: the filter and search are cleared first, since a site the
	// reader asked for must not be hidden by a filter they set for something else.
	function goToSite(siteName: string) {
		reviewTab = 'sites';
		siteSearch = '';
		reviewFilter = 'all';
		const at = siteGroups.findIndex((g) => g.siteName === siteName);
		if (at >= 0) sitePage = Math.floor(at / sitesPerPage);
		expandedSites = new Set(expandedSites).add(siteName);
		flashTo(`site-row-${siteName}`);
	}

	/// Where an object on the card lives. A project has no tab of its own: it is the plan.
	function goToObject(decision: ObjectDecision) {
		if (decision.kind === 'site') goToSite(decision.name);
		else if (decision.kind === 'parameter') goToParam(decision.name);
	}

	// A parameter that does not exist yet is created once per name, so entries converging onto it
	// must carry the units the operator picked or the created parameter takes whichever units the
	// server happened to see first.
	function newParamOption(name: string, units: string): string {
		return `new:${name}::${units}`;
	}

	function parseNewParamOption(value: string): { name: string; units: string | null } {
		const body = value.slice(4);
		const sep = body.lastIndexOf('::');
		if (sep === -1) return { name: body, units: null };
		return { name: body.slice(0, sep), units: body.slice(sep + 2) };
	}

	function renameGlobalParam(oldName: string, newName: string, newUnits?: string) {
		if (!newName.trim()) return;
		if (newName === oldName && newUnits === undefined) return;
		const updates: PlanEntryUpdate[] = [];
		for (const e of planEntries) {
			if (e.parameter.name === oldName) {
				e.parameter.name = newName.trim();
				e.parameter.create = true;
				e.parameter.id = null;
				const update: PlanEntryUpdate = { stream_id: e.stream_id, parameter_name: newName.trim() };
				if (newUnits !== undefined && newUnits !== e.parameter.units) {
					e.parameter.units = newUnits;
					update.parameter_units = newUnits;
				}
				updates.push(update);
			}
		}
		planEntries = [...planEntries];
		queueUpdate(updates);
	}

	function splitSourceToNewParam(sourceName: string, newParamName: string) {
		if (!newParamName.trim()) return;
		const updates: PlanEntryUpdate[] = [];
		for (const e of planEntries) {
			if (e.original_parameter_name === sourceName) {
				e.parameter.name = newParamName.trim();
				e.parameter.create = true;
				e.parameter.id = null;
				updates.push({ stream_id: e.stream_id, parameter_name: newParamName.trim() });
			}
		}
		planEntries = [...planEntries];
		queueUpdate(updates);
		splitParamInput = null;
		splitParamValue = '';
	}

	function startEditGlobalParam(name: string) {
		editingGlobalParam = name;
		editValue = name;
	}

	function commitEditGlobalParam() {
		if (!editingGlobalParam) return;
		renameGlobalParam(editingGlobalParam, editValue);
		editingGlobalParam = null;
	}

	function mapParamToExisting(oldName: string, existingParam: Parameter) {
		renameGlobalParam(oldName, existingParam.code);
	}

	let editingGlobalUnits = $state<{ name: string; units: string } | null>(null);
	let editUnitsValue = $state('');

	function startEditUnits(paramName: string, currentUnits: string) {
		editingGlobalUnits = { name: paramName, units: currentUnits };
		editUnitsValue = currentUnits;
	}

	function commitEditUnits() {
		if (!editingGlobalUnits || !editUnitsValue.trim()) { editingGlobalUnits = null; return; }
		const { name: oldName, units: oldUnits } = editingGlobalUnits;
		const newUnits = editUnitsValue.trim();
		const updates: PlanEntryUpdate[] = [];
		for (const e of planEntries) {
			if (e.parameter.name === oldName && e.parameter.units === oldUnits) {
				e.parameter.units = newUnits;
				updates.push({ stream_id: e.stream_id, parameter_units: newUnits });
			}
		}
		planEntries = [...planEntries];
		editingGlobalUnits = null;
		queueUpdate(updates);
	}

	// Display-label editing applies only to parameters the plan creates; a matched existing
	// parameter keeps its own name (edited on the Parameters page).
	let editingLabel = $state<string | null>(null);
	let editLabelValue = $state('');

	function startEditLabel(pg: { name: string; label: string | null }) {
		editingLabel = pg.name;
		editLabelValue = pg.label ?? '';
	}

	function focusOnMount(node: HTMLInputElement) {
		node.focus();
	}

	function commitEditLabel() {
		if (editingLabel === null) return;
		const name = editingLabel;
		const newLabel = editLabelValue.trim();
		editingLabel = null;
		if (!newLabel) return;
		const updates: PlanEntryUpdate[] = [];
		for (const e of planEntries) {
			if (e.parameter.name === name && (e.parameter.label ?? '') !== newLabel) {
				e.parameter.label = newLabel;
				updates.push({ stream_id: e.stream_id, parameter_label: newLabel });
			}
		}
		if (updates.length === 0) return;
		planEntries = [...planEntries];
		queueUpdate(updates);
	}

	// ── Plan-wide decisions ──
	// A predicate the server applies, not a client-built list the size of the plan: a CNET plan is
	// 1891 entries and a NOMIS one 29,400.
	interface BulkActionOption {
		key: string;
		label: string;
		title: string;
		where: { confidence?: string; has_warnings?: boolean };
		action: 'pair' | 'skip';
		count: number;
	}

	let bulkRunning = $state<string | null>(null);

	const bulkActions = $derived.by((): BulkActionOption[] => {
		const pairable = (e: PairingPlanEntry) =>
			e.site.name.trim() !== '' && e.parameter.name.trim() !== '';
		const matched = planEntries.filter((e) => e.confidence === 'exact');
		const unmatched = planEntries.filter((e) => e.confidence !== 'exact');
		const warned = planEntries.filter((e) => e.warnings.length > 0);
		return [
			{
				key: 'pair-matched',
				label: 'Pair all matched',
				title: 'Every entry whose project, site and parameter all resolve to existing entities',
				where: { confidence: 'exact' },
				action: 'pair',
				count: matched.filter((e) => e.action !== 'pair' && pairable(e)).length,
			},
			{
				key: 'skip-unmatched',
				label: 'Skip all unmatched',
				title: 'Every entry this plan would create a project, site or parameter for',
				where: { confidence: 'none' },
				action: 'skip',
				count: unmatched.filter((e) => e.action !== 'skip').length,
			},
			{
				key: 'skip-warnings',
				label: 'Skip all with warnings',
				title: 'Every entry the plan raised a warning on',
				where: { has_warnings: true },
				action: 'skip',
				count: warned.filter((e) => e.action !== 'skip').length,
			},
		];
	});

	async function runBulkAction(option: BulkActionOption) {
		if (!plan || option.count === 0) return;
		bulkRunning = option.key;
		try {
			// Pending edits first: the bulk arm runs before the per-entry updates on the server,
			// so flushing keeps the order the operator made the decisions in.
			await flushUpdates();
			const updated = await bulkUpdatePairingPlan(plan.id, plan.version, {
				where: option.where,
				action: option.action,
			});
			plan = updated;
			planEntries = [...updated.entries];
			planSelection = prune(planSelection, planEntries);
			editGeneration++;
			toastStore.success(`${option.label}: ${formatCount(option.count)} entries`);
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'The bulk action was not applied');
		} finally { bulkRunning = null; }
	}

	// ── Unsaved decisions ──
	// A generation counter drops server snapshots that would overwrite local edits made while the
	// PATCH was in flight; the queue itself lives in draftQueue.ts, where it is tested.
	let editGeneration = 0;
	let unsavedCount = $state(0);

	const draftQueue = createDraftQueue<PlanUpdate>({
		send: async (batch) => {
			if (!plan) return;
			const generation = editGeneration;
			saving = true;
			try {
				const split = splitPlanUpdates(batch);
				const updated = await updatePairingPlan(
					plan.id,
					plan.version,
					split.entries,
					split.curves,
					split.objects,
					split.proposals,
				);
				if (editGeneration === generation) {
					plan = updated;
					planEntries = [...updated.entries];
			planSelection = prune(planSelection, planEntries);
				} else {
					// The snapshot is stale, but its version is what the next write must name.
					plan = { ...plan, version: updated.version };
				}
			} catch (e) {
				// Someone else edited the draft: reload it so the retry writes against what is
				// there now, rather than losing this batch or theirs.
				if (e instanceof ApiError && e.status === 409) {
					try {
						const reloaded = await getPairingPlan(plan.id);
						plan = reloaded;
						planEntries = [...reloaded.entries];
			planSelection = prune(planSelection, planEntries);
						toastStore.error('Someone else edited this plan; it was reloaded and your change will be reapplied.');
						throw new ApiError(503, 'Plan reloaded, reapplying');
					} catch (reload) {
						if (reload instanceof ApiError && reload.status === 503) throw reload;
						toastStore.error('Someone else edited this plan and it could not be reloaded.');
						throw e;
					}
				}
				throw e;
			} finally { saving = false; }
		},
		statusOf: (e) => (e instanceof ApiError ? e.status : undefined),
		onPendingChange: (n) => { unsavedCount = n; },
		onSaved: () => { lastSavedAt = new Date(); saveRefused = false; },
		onRefused: (e) => {
			saveRefused = true;
			toastStore.error(`Change not applied: ${e instanceof Error ? e.message : e}`);
		},
		onRetryScheduled: (attempt, delay) =>
			toastStore.error(`Could not save; retrying in ${Math.round(delay / 1000)}s (attempt ${attempt})`),
	});

	// A decision must not be lost to a sidebar link, a browser back or a closed tab inside the
	// debounce window: both exits flush what is queued.
	const flushPending = () => { if (draftQueue.pending() > 0) void draftQueue.flush().catch(() => {}); };
	beforeNavigate(flushPending);
	if (typeof window !== 'undefined') {
		window.addEventListener('pagehide', flushPending);
		onDestroy(() => window.removeEventListener('pagehide', flushPending));
	}

	// A decision is one PATCH: only text edits wait for the debounce.
	// A register row's decision is one PATCH of its own, like an object's.
	function queueProposal(sourceKey: string, admit: boolean, attachTo: string | null = null) {
		if (plan) {
			plan = {
				...plan,
				instrument_proposals: (plan.instrument_proposals ?? []).map((p) =>
					p.source_key === sourceKey ? { ...p, admit, attach_to: attachTo } : p,
				),
			};
		}
		editGeneration++;
		draftQueue.enqueue([{ source_key: sourceKey, admit, attach_to: attachTo }], {
			immediate: true,
		});
	}

	// An object decision is one PATCH of its own: it is a click, and the card must say it landed.
	function queueObject(key: string, accepted: boolean) {
		objectOverlay = new Map(objectOverlay).set(key, accepted);
		editGeneration++;
		draftQueue.enqueue([{ key, accepted }], { immediate: true });
	}

	function queueUpdate(updates: PlanEntryUpdate[], opts?: { immediate?: boolean }) {
		editGeneration++;
		draftQueue.enqueue(updates, opts);
	}

	function flushUpdates(): Promise<void> {
		return draftQueue.flush();
	}

	// ── Actions ──
	function setEntryAction(entry: PairingPlanEntry, action: 'pair' | 'skip') {
		if (entry.action === action) return;
		entry.action = action;
		planEntries = [...planEntries];
		queueUpdate([{ stream_id: entry.stream_id, action }], { immediate: true });
	}

	// Deciding is not editing: this records that a person looked and agreed, and nothing else on
	// the entry moves.
	function setEntryAcknowledged(entry: PairingPlanEntry, acknowledged: boolean) {
		if ((entry.acknowledged ?? false) === acknowledged) return;
		entry.acknowledged = acknowledged;
		planEntries = [...planEntries];
		queueUpdate([{ stream_id: entry.stream_id, acknowledged }], { immediate: true });
	}

	// ── Object decisions ──
	// A project, a site or a parameter this plan creates is one decision however many rows name it,
	// so it is accepted once here and every row it was holding up reads as checked.
	// The plan records which objects the review accepted; the overlay is this session's clicks
	// before their PATCH has come back.
	let objectOverlay = $state<Map<string, boolean>>(new Map());
	const acceptedObjectKeys = $derived.by(() => {
		const keys = new Set((plan?.accepted_objects ?? []).map((a) => a.key));
		for (const [key, accepted] of objectOverlay) {
			if (accepted) keys.add(key);
			else keys.delete(key);
		}
		return keys;
	});
	const planObjects = $derived(objectDecisions(planEntries, acceptedObjectKeys));
	const openObjects = $derived(planObjects.filter((d) => !d.accepted));
	const activeTab = $derived(activeReviewTab(reviewTab, planObjects.length, openObjects.length));

	// Accepting an object records the decision; the rows it completes are ticked with it, and a row
	// naming an object nobody has accepted yet waits for that one.
	function acceptObject(decision: ObjectDecision) {
		if (decision.accepted) {
			queueObject(decision.key, false);
			return;
		}
		acceptObjects([decision]);
	}

	// One acceptance per object, then one acknowledgement update over every row the set settles:
	// a row naming three objects is ticked once, when the last of them is accepted.
	function acceptObjects(decisions: ObjectDecision[]) {
		const accepted = new Set(acceptedObjectKeys);
		const settled = new Map<string, PairingPlanEntry>();
		for (const d of decisions) {
			if (d.accepted) continue;
			accepted.add(d.key);
			for (const e of entriesSettledBy(planEntries, d.key, accepted)) settled.set(e.stream_id, e);
			queueObject(d.key, true);
		}
		if (settled.size === 0) return;
		for (const e of settled.values()) e.acknowledged = true;
		planEntries = [...planEntries];
		queueUpdate(
			[...settled.keys()].map((stream_id) => ({ stream_id, acknowledged: true })),
			{ immediate: true },
		);
	}

	function setSiteAction(group: SiteGroup, action: 'pair' | 'skip') {
		const updates: PlanEntryUpdate[] = [];
		for (const e of group.entries) {
			if (e.action !== action) {
				e.action = action;
				updates.push({ stream_id: e.stream_id, action });
			}
		}
		if (updates.length > 0) { planEntries = [...planEntries]; queueUpdate(updates, { immediate: true }); }
	}

	// Pair or skip a parameter everywhere it appears. This is the bulk action the review actually
	// needs: a parameter is one decision across every station, not one per stream.
	function setParamGroupAction(pg: ParamGroup, action: 'pair' | 'skip') {
		const updates: PlanEntryUpdate[] = [];
		for (const e of planEntries) {
			if (!pg.streamIds.includes(e.stream_id)) continue;
			// An entry missing a site or parameter name cannot pair; the server skips it too.
			if (action === 'pair' && (!e.site.name.trim() || !e.parameter.name.trim())) continue;
			if (e.action !== action) {
				e.action = action;
				updates.push({ stream_id: e.stream_id, action });
			}
		}
		if (updates.length > 0) {
			planEntries = [...planEntries];
			queueUpdate(updates, { immediate: true });
		}
	}

	function startEditSite(siteName: string) {
		editingSite = siteName;
		editValue = siteName;
	}

	function commitEditSite() {
		if (!editingSite || !editValue.trim() || editValue === editingSite) { editingSite = null; return; }
		renameSiteGlobal(editingSite, editValue.trim());
		editingSite = null;
	}

	function renameSiteGlobal(oldName: string, newName: string) {
		const entries = planEntries.filter((e) => e.site.name === oldName);
		const updates: PlanEntryUpdate[] = entries.map((e) => ({ stream_id: e.stream_id, site_name: newName }));
		for (const e of entries) { e.site.name = newName; e.site.create = true; e.site.id = null; }
		planEntries = [...planEntries];
		queueUpdate(updates);
	}

	function mapSiteToExisting(oldName: string, existingSite: Site) {
		renameSiteGlobal(oldName, existingSite.name);
	}

	function startEditParam(siteName: string, entry: PairingPlanEntry) {
		editingParam = { site: siteName, streamId: entry.stream_id };
		editValue = entry.parameter.name;
	}

	function commitEditParam() {
		if (!editingParam || !editValue.trim()) { editingParam = null; return; }
		const entry = planEntries.find((e) => e.stream_id === editingParam!.streamId);
		if (!entry || editValue === entry.parameter.name) { editingParam = null; return; }
		entry.parameter.name = editValue.trim();
		entry.parameter.create = true;
		entry.parameter.id = null;
		planEntries = [...planEntries];
		editingParam = null;
		queueUpdate([{ stream_id: entry.stream_id, parameter_name: editValue.trim() }]);
	}

	function toggleExpand(siteName: string) {
		const next = new Set(expandedSites);
		if (next.has(siteName)) next.delete(siteName); else next.add(siteName);
		expandedSites = next;
	}

	// ── Stream list functions ──
	async function load() {
		loading = true;
		error = null;
		try {
			const f: Record<string, unknown> = {};
			// Pairing status: `_neq null` => IS NOT NULL (paired), `null` => IS NULL (unpaired).
			if (listFilter === 'paired') f.site_parameter_id_neq = null;
			if (listFilter === 'unpaired') f.site_parameter_id = null;
			if (searchQuery.trim()) f.q = searchQuery.trim();
			// Source-system filter: send an IN list unless every known source is selected.
			if (sourcesInitialized && selectedSources.size < allSourceSystems.length) {
				f.source_system = [...selectedSources];
			}
			const [result, spResult, sResult, pResult] = await Promise.all([
				api.dataStreams.list({ page: currentPage, perPage, sort: [sortField, sortOrder], filter: f }),
				siteParams.length === 0 ? api.siteParameters.list({ perPage: 500 }) : Promise.resolve(null),
				sites.length === 0 ? api.sites.list({ perPage: 200 }) : Promise.resolve(null),
				params.length === 0 ? api.parameters.list({ perPage: 500 }) : Promise.resolve(null),
			]);
			streams = result.data;
			total = result.total;
			if (spResult) siteParams = spResult.data;
			if (sResult) sites = sResult.data;
			if (pResult) params = pResult.data;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load streams';
			toastStore.error('Failed to load streams');
		} finally { loading = false; }
	}

	function toggleSort(field: string) {
		if (sortField === field) {
			sortOrder = sortOrder === 'ASC' ? 'DESC' : 'ASC';
		} else {
			sortField = field;
			sortOrder = 'ASC';
		}
		currentPage = 1;
		load();
	}

	const sortArrow = (field: string) => (sortField === field ? (sortOrder === 'ASC' ? ' ↑' : ' ↓') : '');

	function toggleSource(src: string) {
		const next = new Set(selectedSources);
		if (next.has(src)) next.delete(src);
		else next.add(src);
		selectedSources = next;
		currentPage = 1;
		load();
	}

	function sourceCount(src: string): number {
		const s = sourceSummary.find((x) => x.source_system === src);
		return s ? s.paired + s.unpaired : 0;
	}

	function siteParamLabel(spId: string | null): string {
		if (!spId) return 'Unpaired';
		const sp = siteParams.find((s) => s.id === spId);
		if (!sp) return spId;
		const site = sites.find((s) => s.id === sp.site_id);
		const param = params.find((p) => p.id === sp.parameter_id);
		return `${site?.name ?? '?'} / ${param?.name ?? '?'}`;
	}

	/** Deep link to the paired slot's site page, scrolled to that parameter's chart (?focus anchor). */
	function siteParamHref(spId: string | null): string | null {
		if (!spId) return null;
		const sp = siteParams.find((s) => s.id === spId);
		if (!sp) return null;
		return `${base}/sites/${sp.site_id}?focus=${sp.parameter_id}`;
	}

	function openPairDialog(stream: DataStream) { pairStream_ = stream; selectedSiteParam = ''; pairDialogOpen = true; }

	async function handlePair() {
		if (!pairStream_ || !selectedSiteParam) return;
		pairing = true;
		try {
			const res = await pairStream(pairStream_.id, selectedSiteParam);
			toastStore.success(`Stream paired · ${formatCount(res.backfilled)} reading${res.backfilled === 1 ? '' : 's'} attributed`);
			pairDialogOpen = false;
			load();
		}
		catch (e) { toastStore.error(`Pairing failed: ${e instanceof Error ? e.message : e}`); }
		finally { pairing = false; }
	}

	async function handleUnpair(streamId: string) {
		try {
			const res = await unpairStream(streamId);
			toastStore.success(`Stream unpaired · ${formatCount(res.cleared)} reading${res.cleared === 1 ? '' : 's'} un-attributed`);
			load();
		}
		catch (e) { toastStore.error(`Unpair failed: ${e instanceof Error ? e.message : e}`); }
	}

	// Classify a stream's cadence; existing readings are retagged by a tracked job so charts and
	// aggregates agree with the new classification.
	// The one command that corrects rows already stored, per stream. Only offered where a reachable
	// service feeds the stream's source system; the internal channels have none.
	let syncServices = $state<SyncService[]>([]);
	let resyncing = $state<Record<string, boolean>>({});

	const resyncServiceForStream = (stream: DataStream) =>
		resyncServiceFor(syncServices, stream.source_system);

	async function handleResync(stream: DataStream) {
		const svc = resyncServiceForStream(stream);
		if (!svc) return;
		resyncing[stream.id] = true;
		try {
			await issueSyncCommand(svc.id, 'resync_streams', { source_keys: [stream.source_key] });
			toastStore.success(`Repair queued with ${svc.instance_id}`);
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to queue the repair');
		} finally {
			resyncing[stream.id] = false;
		}
	}

	async function handleRetagStream(stream: DataStream, type: 'continuous' | 'spot') {
		try {
			await retagStreams({ streamIds: [stream.id] }, type, true);
			toastStore.success(
				`Stream classified as ${type === 'spot' ? 'grab samples' : type}; existing readings are being retagged`,
			);
			load();
		} catch (e) { toastStore.error(e instanceof Error ? e.message : 'Reclassification failed'); }
	}

	async function openStats(stream: DataStream) {
		statsStream = stream; stats = null; receipts = null; statsDialogOpen = true;
		try { stats = await getStreamStats(stream.id); } catch (e) { toastStore.error(`Failed to load stats: ${e instanceof Error ? e.message : e}`); }
		// The reconciliation ledger only exists for windowed (portal spot) streams; absence is
		// normal and renders as nothing.
		try { receipts = (await listStreamReceipts(stream.id, 1, 10)).receipts; } catch { receipts = []; }
	}

	// ── Wizard navigation ──
	// Drafts still open per source: the way back into a review someone left half done.
	let openDrafts = $state<PairingPlanListing[]>([]);
	const draftFor = (sourceSystem: string) =>
		openDrafts.find((d) => d.source_system === sourceSystem);
	const appliedFor = (sourceSystem: string) =>
		appliedPlans.find((p) => p.source_system === sourceSystem);

	async function enterSourceSelect() {
		setMode('source-select');
		await loadSourceSelect();
	}

	/** The sources, their drafts and their applied plans: what the source step is made of. */
	async function loadSourceSelect() {
		planLoading = true;
		try {
			const [summary, drafts, applied] = await Promise.all([
				getUnpairedSummary(),
				listPairingPlans({ status: 'draft' }).catch(() => [] as PairingPlanListing[]),
				listPairingPlans({ status: 'applied' }).catch(() => [] as PairingPlanListing[]),
			]);
			unpairedSummary = summary;
			openDrafts = drafts;
			appliedPlans = applied;
		}
		catch (e) { toastStore.error(`Failed to load unpaired summary: ${e instanceof Error ? e.message : e}`); setMode('list'); }
		finally { planLoading = false; }
	}

	let existingParams = $state<Parameter[]>([]);
	let existingSites = $state<Site[]>([]);
	// Candidates for repointing a curve column, so an operator can correct a bad match instead of
	// creating a second instrument beside the right one.
	let labInstruments = $state<Array<{ id: string; name: string | null; serial_number: string | null }>>([]);
	let siteMetadataMap = $state<Map<string, SiteMetadata>>(new Map());

	// Case-insensitive match against code, name, and aliases (mirrors server-side matching).
	// A hundred parameter rows each ask the catalog the same question, and several ask it per row,
	// so the catalog is indexed once instead of scanned per question.
	const paramIndex = $derived(parameterIndex(existingParams));

	function matchParam(name: string): Parameter | undefined {
		const q = name.trim().toLowerCase();
		if (!q) return undefined;
		return paramIndex.get(q);
	}

	// Open a plan in the review: the catalogs the dropdowns and matched-badges read are refetched
	// with it, since a plan created yesterday is reviewed against today's entities.
	async function openPlan(loadPlan: () => Promise<PairingPlan>, resuming: boolean) {
		planLoading = true;
		try {
			const [loaded, paramResult, siteResult, instrumentResult] = await Promise.all([
				loadPlan(),
				api.parameters.list({ perPage: 1000 }),
				api.sites.list({ perPage: 1000 }),
				api.sensors.list({ perPage: 500, filter: { is_lab_instrument: true } }),
			]);
			labInstruments = instrumentResult.data.map((s) => ({
				id: s.id,
				name: s.name ?? null,
				serial_number: s.serial_number ?? null,
			}));
			plan = loaded;
			planEntries = [...loaded.entries];
			planSelection = prune(planSelection, planEntries);
			params = paramResult.data;
			sites = siteResult.data;
			existingParams = params;
			existingSites = sites;
			expandedSites = new Set();
			expandedReplicates = new Set();
			lastSavedAt = null;
			saveRefused = false;
			objectOverlay = new Map();
			// A resumed review keeps the position the URL carries; a new plan starts at the top.
			if (!resuming) {
				siteSearch = '';
				reviewFilter = 'all';
				sitePage = 0;
				paramPage = 0;
			}
			applyResult = null;
			setMode('review');
			void loadPlanInstruments();
			getPlanSiteMetadata(loaded.id).then((meta) => {
				const map = new Map<string, SiteMetadata>();
				for (const m of meta) map.set(m.site_name, m);
				siteMetadataMap = map;
			}).catch(() => {});
		} catch (e) {
			toastStore.error(
				`Failed to ${resuming ? 'open' : 'create'} plan: ${e instanceof Error ? e.message : e}`,
			);
			if (resuming) setMode('list');
			throw e;
		} finally { planLoading = false; }
	}

	async function createPlan(sourceSystem: string) {
		await openPlan(() => createPairingPlan(sourceSystem), false).catch(() => {});
	}

	async function resumePlan(planId: string) {
		await openPlan(() => getPairingPlan(planId), true).catch(() => {});
	}

	// Start over leaves the decisions on the draft it replaces rather than deleting them: the old
	// draft becomes superseded, which apply refuses the way it refuses an applied plan.
	async function startOverPlan(draft: PairingPlanListing) {
		planLoading = true;
		try {
			await supersedePairingPlan(draft.id);
			openDrafts = openDrafts.filter((d) => d.id !== draft.id);
		} catch (e) {
			toastStore.error(`Failed to supersede the old draft: ${e instanceof Error ? e.message : e}`);
			planLoading = false;
			return;
		}
		planLoading = false;
		await createPlan(draft.source_system);
	}

	// Discard is the draft's own, not the wizard's: leaving the wizard saves, so the only place a
	// decision can actually be thrown away is the row that holds it.
	async function discardPlan(draft: PairingPlanListing) {
		try {
			await supersedePairingPlan(draft.id);
			openDrafts = openDrafts.filter((d) => d.id !== draft.id);
			toastStore.success('Draft discarded');
		} catch (e) {
			toastStore.error(`Failed to discard the draft: ${e instanceof Error ? e.message : e}`);
		}
	}

	// The apply is a job, so the wizard starts it and lets go (Q88): the operations panel carries
	// its progress, and the counts are read afterwards from the plan, by URL, whether or not this
	// tab is still open.
	async function applyPlan() {
		if (!plan) return;
		try {
			await flushUpdates();
		} catch {
			toastStore.error('Unsaved edits could not be saved; the plan was not applied.');
			return;
		}
		applying = true;
		const planId = plan.id;
		try {
			const { job_id } = await applyPairingPlan(plan.id, plan.version);
			planRuns = { ...planRuns, applyJobId: job_id, applyingPlanId: planId };
			toastStore.success('Applying the plan. Its progress is in the operations panel; the counts appear here when it finishes.');
			plan = null; planEntries = []; applyResult = null;
			// Back to the source list, where the row for the plan just applied is the one in front
			// of the operator, rather than to the streams list which names no running job.
			await enterSourceSelect();
		} catch (e) { toastStore.error(e instanceof Error ? e.message : 'Failed to apply plan'); }
		finally { applying = false; }
	}

	/// The results of an apply that has already run, read from the plan the job wrote them to.
	async function openResults(planId: string) {
		planLoading = true;
		try {
			const applied = await getPairingPlan(planId);
			applyResult = (applied.apply_result ?? null) as PairingPlanApplyResult | null;
			plan = applied;
			if (!applyResult) {
				toastStore.info('That plan has not finished applying; its progress is in the operations panel.');
				setMode('list');
				return;
			}
			const url = new URL(page.url);
			url.searchParams.set('step', 'results');
			url.searchParams.set('plan', planId);
			goto(url.toString(), { replaceState: true, noScroll: true });
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to load the plan');
			setMode('list');
		} finally { planLoading = false; }
	}

	async function revertPlan() {
		if (!plan) return;
		reverting = true;
		const planId = plan.id;
		try {
			const { job_id } = await revertPairingPlan(planId);
			planRuns = { ...planRuns, revertJobId: job_id, revertingPlanId: planId };
			toastStore.success('Reverting the plan. Its progress is in the operations panel; what it undid is recorded there.');
			plan = null; planEntries = []; applyResult = null;
			await enterSourceSelect();
		} catch (e) { toastStore.error(e instanceof Error ? e.message : 'Failed to revert plan'); }
		finally { reverting = false; }
	}

	async function exitWizard() {
		try {
			await flushUpdates();
		} catch {
			// The toast from the failed flush is the signal; leaving the wizard still proceeds.
		}
		plan = null; planEntries = []; applyResult = null;
		setMode('list'); load();
	}

	// A plan's row reads "Applying…"/"Reverting…" off a job this tab started, so the label is
	// cleared by the job's own completion rather than left standing for the session.
	let unsubJobCompleted: (() => void) | null = null;
	onMount(() => {
		unsubJobCompleted = eventBus.subscribe('job_completed', (event) => {
			const finished = (event as { job_id: string }).job_id;
			const after = runsAfterJob(planRuns, finished);
			if (after === planRuns) return;
			planRuns = after;
			if (mode === 'source-select') void loadSourceSelect();
		});
	});

	// The gate, as one list read by both the strip and the Apply button. Every count here is a
	// number the review already holds; nothing is decided a second time.
	const gateItems = $derived(
		planGateItems({
			objects: { accepted: planObjects.length - openObjects.length, total: planObjects.length },
			instruments: {
				decided: instrumentDecisions.length - openInstrumentQuestions,
				total: instrumentDecisions.length,
			},
			rows: { ticked: reviewProgress.acknowledged, total: reviewProgress.total },
			unitConflicts: uniqueWarnings.length,
		}),
	);
	const blockingGates = $derived(gateBlocking(gateItems));

	function gateHint(item: GateItem): string {
		if (item.state === 'blocking') return 'Apply is refused until this is settled';
		if (item.state === 'done') return 'Settled';
		return 'Worth knowing; it does not stop the apply';
	}

	// A gate opens the review tab that settles it.
	function goToGate(item: GateItem) {
		reviewTab = item.tab;
		if (item.tab === 'sites') sitePage = 0;
	}
	onDestroy(() => unsubJobCompleted?.());

	onMount(async () => {
		// Build the source-system facet first so the initial list can default to
		// hiding non-instrument (CSV/batch + grab-sample) streams.
		try {
			sourceSummary = await getUnpairedSummary();
			selectedSources = new Set(
				linkedSource !== null
					? sourceSummary.map((s) => s.source_system).filter((s) => s === linkedSource)
					: sourceSummary.map((s) => s.source_system).filter((s) => !NON_INSTRUMENT_SOURCES.includes(s)),
			);
			sourcesInitialized = true;
		} catch {
			// Facet is optional; fall back to showing everything.
			sourcesInitialized = true;
		}
		await load();
		void loadReplicateSurfacing();
		try {
			syncServices = (await getList<SyncService>('/api/sync_services', { perPage: 50 })).data;
		} catch {
			// Without the service list no repair is offered, which is the right default.
		}
		// A fired brake's chip on a reading opens its stream's dialog, where the brake is released.
		const statsId = page.url.searchParams.get('stats');
		if (statsId) {
			try {
				await openStats(await api.dataStreams.get(statsId));
			} catch (e) {
				toastStore.error(`Failed to open the stream: ${e instanceof Error ? e.message : e}`);
			}
		}
		// A reload or a bookmark on ?step=review&plan=<id> reopens that review; the draft on the
		// server is the record, so the page rebuilds from it rather than rendering nothing.
		const resumeId = page.url.searchParams.get('plan');
		// A link from the source audit lands on the step directly, so it loads its own sources.
		if (mode === 'source-select' && unpairedSummary.length === 0) await loadSourceSelect();
		else if (mode === 'review' && resumeId && !plan) await resumePlan(resumeId);
		else if (mode === 'review' && !resumeId) setMode('list');
		// The same for ?step=results&plan=<id>: the counts belong to the plan, not to the call
		// that started the job, so they survive the tab that started it.
		else if (mode === 'results' && resumeId && !applyResult) await openResults(resumeId);
		else if (mode === 'results' && !resumeId) setMode('list');
	});
</script>

<!-- A source parameter whose units disagree with the catalog entry it matches, with both ways
     out, beside the parameters it is about rather than above the whole review. -->
{#snippet unitConflicts()}
	{#each uniqueWarnings as w (w.warning.message)}
		<div class="rounded border border-severity-warning-border bg-severity-warning-soft px-3 py-2 text-sm text-severity-warning-text">
			<div>{w.warning.message}</div>
			{#if w.warning.existing}
				{@const ex = w.warning.existing}
				<p class="text-xs mt-1 opacity-90">
					The catalog entry is
					<a href="{base}/parameters/{ex.id}" class="font-mono underline-offset-2 hover:underline">{ex.code}</a>
					({ex.name}), used by {ex.site_parameter_count} site{ex.site_parameter_count === 1 ? '' : 's'}
					and {formatCount(ex.reading_count)} reading{ex.reading_count === 1 ? '' : 's'}.
					Affects {formatCount(w.count)} stream{w.count === 1 ? '' : 's'}.
				</p>
				<div class="flex flex-wrap items-center gap-2 mt-2">
					<Button size="sm" onclick={() => adoptCatalogUnits(w)}>Keep catalog units ({ex.units})</Button>
					<Button size="sm" onclick={() => adoptSourceUnits(w)}>Use source units ({w.warning.source_units})</Button>
					<Button variant="ghost" size="sm" onclick={() => goToParam(w.paramName)}>Open in Parameters</Button>
				</div>
			{:else}
				<p class="text-xs mt-1 opacity-90">Affects {formatCount(w.count)} stream{w.count === 1 ? '' : 's'}.</p>
			{/if}
		</div>
	{/each}
{/snippet}

{#snippet replicateChip(key: string, rep: PlanReplicateSummary, streamId: string)}
	<button
		onclick={(e) => { e.stopPropagation(); toggleReplicateExpand(key, streamId); }}
		class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-brand-accent/10 text-brand-accent border border-brand-accent/30 cursor-pointer text-[10px] font-semibold whitespace-nowrap"
		title="This stream records {rep.n} replicates per instant; expand to see how the source columns route"
	>⧉ {rep.n} replicates {expandedReplicates.has(key) ? '▾' : '▸'}</button>
{/snippet}

<!-- The preview's own handle, for a row with no replicate family to carry one. -->
{#snippet valuesChip(streamId: string)}
	<button
		onclick={(e) => { e.stopPropagation(); toggleReplicateExpand(streamId, streamId); }}
		class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-brand-bg text-brand-muted border border-brand-divider cursor-pointer text-[10px] whitespace-nowrap"
		title="The most recent readings this stream holds"
	>values {expandedReplicates.has(streamId) ? '▾' : '▸'}</button>
{/snippet}

{#snippet replicateRouting(rep: PlanReplicateSummary, streamId: string)}
	<div class="space-y-0.5 text-[11px]">
		{#each rep.member_columns as col, i}
			<div class="font-mono">{col} → replicate {i}</div>
		{/each}
		{#if rep.curve_ref_column}
			<div class="font-mono text-brand-muted">{rep.curve_ref_column} → standard curve reference</div>
		{/if}
		<p class="text-brand-muted pt-0.5">
			x̄ and s are calculated from the {rep.n} stored replicates. The source's
			{rep.portal_mean_column ?? 'average'}{rep.portal_sd_column ? ` / ${rep.portal_sd_column}` : ''}
			are checked against them, not stored.
		</p>

		<!-- The same routing with this stream's own values in it. -->
		{@render streamPreview(streamId)}
	</div>
{/snippet}

<!-- What the stream actually holds, for a row deciding whether to create a site or a parameter
     for it. The same values whether or not the column is a replicate family. -->
{#snippet streamPreview(streamId: string)}
	{@const preview = previews.get(streamId)}
	<div class="text-[11px]">
		{#if preview === 'loading'}
			<p class="text-brand-muted pt-1">Loading recent readings…</p>
		{:else if preview === 'failed'}
			<p class="text-brand-muted pt-1">Recent readings could not be loaded.</p>
		{:else if preview && preview.instants.length === 0}
			<p class="text-brand-muted pt-1">This stream holds no readings yet.</p>
		{:else if preview}
			{@const indexes = [...new Set(preview.instants.flatMap((i) => i.replicates.map((r) => r.replicate_index)))].sort((a, b) => a - b)}
			{@const labels = new Map(preview.instants.flatMap((i) => i.replicates.map((r) => [r.replicate_index, r.column ?? `rep ${r.replicate_index}`] as const)))}
			<div class="pt-1.5">
				<div class="text-brand-muted mb-0.5">Most recent {preview.instants.length === 1 ? 'reading' : `${preview.instants.length} readings`}, as they will be stored:</div>
				<!-- Long source column names break inside their header cell, so a wide family fits the
				     row rather than scrolling it. -->
				<table class="text-[11px] tabular-nums max-w-full">
					<thead>
						<tr class="text-brand-muted text-left align-bottom">
							<th class="pr-3 font-medium">Instant</th>
							{#each indexes as idx}
								<th class="pr-3 font-medium text-right [overflow-wrap:anywhere]">{labels.get(idx)}</th>
							{/each}
							<th class="pl-2 pr-3 font-medium text-right">x̄</th>
							<th class="pr-3 font-medium text-right">s</th>
							<th class="font-medium text-right">n</th>
						</tr>
					</thead>
					<tbody>
						{#each preview.instants as inst (inst.time)}
							<tr>
								<td class="pr-3 whitespace-nowrap text-brand-muted">{formatDateTime(inst.time)}</td>
								{#each indexes as idx}
									{@const r = inst.replicates.find((x) => x.replicate_index === idx)}
									<td class="pr-3 text-right whitespace-nowrap {r?.is_flagged || r?.withdrawn ? 'line-through opacity-60' : ''}">
										{r?.value === null || r?.value === undefined ? '--' : formatSignificant(r.value)}
									</td>
								{/each}
								<td class="pl-2 pr-3 text-right whitespace-nowrap text-brand-text">{inst.mean?.toFixed(2) ?? '--'}</td>
								<td class="pr-3 text-right whitespace-nowrap text-brand-text">{inst.sd?.toFixed(2) ?? '--'}</td>
								<td class="text-right text-brand-text">{inst.n}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
{/snippet}

{#snippet instrumentNameField(scope: string, anchorStreamId: string, suggestion: string, group: PlanInstrumentGroup | null)}
	{#if group && !group.create && group.instrument_id}
		<!-- An instrument in the inventory: the name belongs to the row, not to this plan. -->
		<a
			href="{base}/sensors/{group.instrument_id}"
			class="font-medium text-brand-text no-underline hover:underline"
			title="This instrument already exists. Its name is edited on its own page, where what else uses it is visible."
		>{group.name}</a>
	{:else if editingInstrument === scope}
		<input
			type="text"
			bind:value={instrumentEditValue}
			onkeydown={(e) => { if (e.key === 'Enter') commitInstrumentName(anchorStreamId, group); if (e.key === 'Escape') editingInstrument = null; }}
			onblur={() => commitInstrumentName(anchorStreamId, group)}
			class="px-1 py-0.5 border border-brand-primary rounded text-sm bg-brand-surface w-72"
			use:focusOnMount
		/>
	{:else}
		<button
			onclick={() => { editingInstrument = scope; instrumentEditValue = group?.name ?? suggestion; }}
			class="bg-transparent border-0 border-b border-dashed cursor-pointer text-left hover:text-brand-primary hover:border-brand-primary {group ? 'font-medium text-brand-text border-brand-muted' : 'text-brand-muted border-brand-muted/60 italic'}"
			title={group ? 'Rename what this plan will create' : 'Proposed name; click to edit, then create it'}
		>{group?.name ?? suggestion}</button>
	{/if}
{/snippet}

<svelte:head><title>Streams | RIVER Data</title></svelte:head>

<!-- ════════════════════ STREAM LIST MODE ════════════════════ -->
{#if mode === 'list'}
	<div class="space-y-4">
		<div class="flex items-center justify-between">
			<h2 class="text-xl font-semibold">Data Streams</h2>
			<div class="flex items-center gap-3">
				<Button variant="primary" onclick={enterSourceSelect} class="font-semibold">Discover & Pair</Button>
			</div>
		</div>

		<Tabs tabs={tabLabels} bind:active={tab.index} />

		{#if tab.key === 'audits' && canAudit}
		<p class="text-sm text-brand-muted">
			Values the source changed after river-data stored them.
		</p>
		<ChangeProposalsPanel onPendingChange={(n) => (pendingProposals = n)} />
		<ReplicateAuditsPanel
			initialView={page.url.searchParams.get('view') === 'resolved' ? 'resolved' : 'review'}
			initialHoldId={page.url.searchParams.get('holds_id') ?? undefined}
			onPendingChange={(n) => (pendingAudits = n)}
		/>
		{:else if tab.key === 'discrepancies' && canAudit}
		<p class="text-sm text-brand-muted">
			What imports recorded about data that disagrees with its source. Each is kept with the
			reading it concerns; nothing here needs an action.
		</p>
		<DiscrepancyBrowse initial={readTagParams(page.url.searchParams)} />
		{:else if tab.key === 'instruments' && canAudit}
		<p class="text-sm text-brand-muted">
			The instruments the sync and the inventory know, the standard curves each one owns, and
			the incoming values those curves corrected.
		</p>
		<InstrumentCurvesPanel />
		{:else}

		{#if pendingAudits > 0 && canAudit}
			<div class="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-severity-warning-soft border border-severity-warning-border text-sm text-severity-warning-text">
				<span>{pendingAudits} item{pendingAudits === 1 ? '' : 's'} need{pendingAudits === 1 ? 's' : ''} audit review{auditBreakdown ? ` · ${auditBreakdown}` : ''}</span>
				<button
					onclick={() => tab.go('audits', undefined, { push: true })}
					class="font-semibold text-severity-warning-text bg-transparent border-none p-0 cursor-pointer underline-offset-2 hover:underline"
				>Review</button>
			</div>
		{/if}

		<div class="flex flex-wrap items-center gap-3">
			<input
				type="text"
				placeholder="Search source key / name…"
				bind:value={searchQuery}
				oninput={() => { currentPage = 1; load(); }}
				class="w-64 px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
			/>
			<div class="flex gap-1">
				{#each ['all', 'paired', 'unpaired'] as f}
					<button
						onclick={() => { listFilter = f as typeof listFilter; currentPage = 1; load(); }}
						class="px-3 py-1 text-sm rounded-md cursor-pointer border-none {listFilter === f ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted hover:text-brand-text'}"
					>{f === 'all' ? 'All' : f === 'paired' ? 'Paired' : 'Unpaired'}</button>
				{/each}
			</div>
		</div>

		{#if sourceSummary.length > 0}
			<div class="flex flex-wrap items-center gap-2">
				<span class="text-xs text-brand-muted">Sources:</span>
				{#each sourceSummary as s}
					<button
						onclick={() => toggleSource(s.source_system)}
						title={selectedSources.has(s.source_system) ? 'Click to hide' : 'Click to show'}
						class="px-2 py-0.5 text-xs rounded-full border cursor-pointer {selectedSources.has(s.source_system) ? 'bg-brand-primary/10 text-brand-primary border-brand-primary/30' : 'bg-brand-bg text-brand-muted border-brand-divider line-through opacity-60'}"
					>{s.source_system} ({sourceCount(s.source_system)})</button>
				{/each}
			</div>
		{/if}

		{#if error}
			<div class="px-3 py-2 rounded-md bg-severity-alarm-soft text-severity-alarm text-sm">{error}</div>
		{/if}

		<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
			<table class="w-full text-sm">
				<thead><tr class="bg-brand-bg border-b border-brand-divider">
					<th class="text-left px-4 py-2 font-semibold cursor-pointer select-none hover:text-brand-primary" onclick={() => toggleSort('source_key')}>Source Key{sortArrow('source_key')}</th>
					<th class="text-left px-4 py-2 font-semibold cursor-pointer select-none hover:text-brand-primary" onclick={() => toggleSort('source_name')}>Source Name{sortArrow('source_name')}</th>
					<th class="text-left px-4 py-2 font-semibold cursor-pointer select-none hover:text-brand-primary" onclick={() => toggleSort('source_system')}>System{sortArrow('source_system')}</th>
					<th class="text-left px-4 py-2 font-semibold">Paired To</th>
					<th class="text-left px-4 py-2 font-semibold cursor-pointer select-none hover:text-brand-primary" onclick={() => toggleSort('last_data_time')}>Last Data{sortArrow('last_data_time')}</th>
					<th class="text-left px-4 py-2 font-semibold">Actions</th>
				</tr></thead>
				<tbody>
					{#if loading}
						<tr><td colspan="6" class="px-4 py-8 text-center text-brand-muted">Loading…</td></tr>
					{:else}
						{#each streams as stream}
							<tr class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50">
								<td class="px-4 py-2 font-mono text-xs">{stream.source_key}</td>
								<td class="px-4 py-2 text-xs">{stream.source_name ?? '--'}</td>
								<td class="px-4 py-2 text-xs">
									<Badge variant="default">{stream.source_system}</Badge>
									{#if stream.measurement_type === 'spot'}
										<Badge variant="accent">grab</Badge>
									{:else if stream.measurement_type === 'derived'}
										<Badge variant="muted">derived</Badge>
									{/if}
									{#if replicateSpec(stream)}
										<ReplicateFamilyBadge spec={replicateSpec(stream)!} />
									{/if}
								</td>
								<td class="px-4 py-2 text-xs">
									{#if stream.site_parameter_id}
										{@const href = siteParamHref(stream.site_parameter_id)}
										{#if href}
											<a {href} title="Open the site page at this parameter's chart" class="no-underline hover:opacity-80">
												<Badge variant="ok">{siteParamLabel(stream.site_parameter_id)}</Badge>
											</a>
										{:else}
											<Badge variant="ok">{siteParamLabel(stream.site_parameter_id)}</Badge>
										{/if}
									{:else}
										<Badge variant="muted">Unpaired</Badge>
									{/if}
								</td>
								<td class="px-4 py-2 text-xs text-brand-muted">{stream.last_data_time ? formatRelativeTime(stream.last_data_time) : '--'}</td>
								<td class="px-4 py-2 flex gap-2">
									<Button variant="ghost" size="sm" onclick={() => openStats(stream)} class="text-brand-primary">Stats</Button>
									{#if stream.measurement_type === 'spot'}
										<ConfirmPopover message="Classify this stream as continuous? Existing readings re-enter hourly/daily averages." confirmLabel="Mark continuous" confirmVariant="primary" onconfirm={() => handleRetagStream(stream, 'continuous')}>
											<Button variant="ghost" size="sm" class="text-brand-primary">Mark continuous</Button>
										</ConfirmPopover>
									{:else if stream.measurement_type !== 'derived'}
										<ConfirmPopover message="Classify this stream as grab samples (low-frequency)? Existing readings render as points and leave hourly/daily averages." confirmLabel="Mark as grab" confirmVariant="primary" onconfirm={() => handleRetagStream(stream, 'spot')}>
											<Button variant="ghost" size="sm" class="text-brand-primary">Mark as grab</Button>
										</ConfirmPopover>
									{/if}
									{#if resyncServiceForStream(stream)}
										{@const resyncSvc = resyncServiceForStream(stream)!}
										<ConfirmPopover message={resyncConfirmation(1, resyncSvc.instance_id)} confirmLabel="Repair" confirmVariant="alarm" onconfirm={() => handleResync(stream)}>
											<Button variant="ghost" size="sm" disabled={resyncing[stream.id]} class="text-severity-alarm">Repair</Button>
										</ConfirmPopover>
									{/if}
									{#if stream.site_parameter_id}
										<ConfirmPopover message="Unpair this stream? Its readings lose their site and parameter, so they leave every chart, the continuous aggregates and the public API; samples left unreferenced are deleted; the sensor's open deployment at that site is closed; and open audit holds on the stream are deferred. Re-pairing restores the attribution." confirmLabel="Unpair" onconfirm={() => handleUnpair(stream.id)}>
											<Button variant="ghost" size="sm" class="text-severity-alarm">Unpair</Button>
										</ConfirmPopover>
									{:else}
										<Button variant="ghost" size="sm" onclick={() => openPairDialog(stream)} class="text-brand-primary">Pair</Button>
									{/if}
								</td>
							</tr>
						{/each}
						{#if streams.length === 0}
							<tr><td colspan="6" class="px-4 py-6 text-center text-brand-muted">
							{#if searchQuery.trim() || selectedSources.size !== allSourceSystems.length}
								No streams match the current filters
							{:else}
								No streams registered yet. They appear after a sync service completes its first discovery cycle.
							{/if}
						</td></tr>
						{/if}
					{/if}
				</tbody>
			</table>
		</div>

		{#if totalPages > 1}
			<div class="flex items-center justify-between text-sm text-brand-muted">
				<span>{total} total</span>
				<div class="flex items-center gap-2">
					<Button size="sm" onclick={() => { currentPage = Math.max(1, currentPage - 1); load(); }} disabled={currentPage <= 1}>Prev</Button>
					<span>{currentPage} / {totalPages}</span>
					<Button size="sm" onclick={() => { currentPage = Math.min(totalPages, currentPage + 1); load(); }} disabled={currentPage >= totalPages}>Next</Button>
				</div>
			</div>
		{/if}

		{/if}
	</div>

<!-- ════════════════════ SOURCE SELECT ════════════════════ -->
{:else if mode === 'source-select'}
	<div class="space-y-4">
		<div class="flex items-center gap-3">
			<Button variant="ghost" size="sm" onclick={() => setMode('list')} class="text-brand-primary">&larr; Back to streams</Button>
			<h2 class="text-xl font-semibold">Discover & Pair Streams</h2>
		</div>

		{#if planLoading}
			<p class="text-brand-muted">Loading sources…</p>
		{:else}
			{@const withUnpaired = unpairedSummary.filter((s) => s.unpaired > 0).sort((a, b) => b.unpaired - a.unpaired)}
			{@const fullyPaired = unpairedSummary.filter((s) => s.unpaired === 0)}

			{#if withUnpaired.length > 0}
				<p class="text-sm text-brand-muted">Select a source to create a pairing plan:</p>
				<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
					<table class="w-full text-sm">
						<tbody>
							{#each withUnpaired as s}
								{@const draft = draftFor(s.source_system)}
								<tr class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50 {draft ? '' : 'cursor-pointer'} {s.source_system === linkedSource ? 'bg-brand-primary/5' : ''}" onclick={() => { if (!draft) createPlan(s.source_system); }}>
									<td class="px-4 py-3 font-semibold">
										{s.source_system}
										{#if draft}
											<div class="text-xs font-normal text-brand-muted pt-0.5">
												Draft started {formatRelativeTime(draft.created_at)}:
												{formatCount(draft.summary.will_pair)} to pair,
												{formatCount(draft.summary.will_skip)} to skip
											</div>
											{#if draft.uncovered_streams}
												<div class="text-xs font-normal text-severity-warning pt-0.5">
													{formatCount(draft.uncovered_streams)} stream{draft.uncovered_streams === 1 ? '' : 's'}
													registered since are not in it; start over to include them.
												</div>
											{/if}
										{/if}
									</td>
									<td class="px-4 py-3 text-right"><span class="text-severity-warning font-semibold">{formatCount(s.unpaired)}</span> <span class="text-brand-muted">unpaired</span></td>
									<td class="px-4 py-3 text-right text-brand-muted">{formatCount(s.paired)} paired</td>
									<td class="px-4 py-3 text-right whitespace-nowrap">
										{#if draft}
											<Button size="sm" onclick={(e) => { e.stopPropagation(); resumePlan(draft.id); }}>Resume</Button>
											<ConfirmPopover
												message="Start a new plan? The open draft keeps its decisions but can no longer be applied."
												confirmLabel="Start over"
												confirmVariant="primary"
												onconfirm={() => startOverPlan(draft)}
											>
												<Button size="sm" variant="ghost">Start over</Button>
											</ConfirmPopover>
											<ConfirmPopover
												message="Discard this draft? Its decisions are lost and its streams stay unpaired."
												confirmLabel="Discard"
												confirmVariant="alarm"
												onconfirm={() => discardPlan(draft)}
											>
												<Button size="sm" variant="ghost">Discard</Button>
											</ConfirmPopover>
										{:else}
											<Button size="sm" onclick={(e) => { e.stopPropagation(); createPlan(s.source_system); }}>Discover</Button>
										{/if}
										{#if appliedFor(s.source_system)}
											{@const done = appliedFor(s.source_system)}
											<Button size="sm" variant="ghost" onclick={(e) => { e.stopPropagation(); openResults(done!.id); }}>
												{#if done!.id === applyingPlanId}Applying…{:else if done!.id === revertingPlanId}Reverting…{:else}Results{/if}
											</Button>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else if unpairedSummary.length === 0}
				<p class="text-brand-muted">No source has registered any streams yet. Streams appear after a sync service completes its first discovery cycle.</p>
				<p class="text-sm"><a class="text-brand-primary" href="{base}/system?tab=status">Check service status</a></p>
			{:else}
				<p class="text-severity-ok">All streams are paired.</p>
			{/if}
			{#if fullyPaired.length > 0}
				<p class="text-xs text-brand-muted">{fullyPaired.map((s) => s.source_system).join(', ')} -- fully paired ({formatCount(fullyPaired.reduce((a, s) => a + s.paired, 0))} streams)</p>
			{/if}
		{/if}
	</div>

<!-- ════════════════════ PLAN REVIEW ════════════════════ -->
{:else if mode === 'review' && plan}
	<div class="space-y-4">
		<!-- Header -->
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3">
				<Button variant="ghost" size="sm" onclick={exitWizard} class="text-brand-primary" title="The draft keeps every decision taken; discard it from its row on the streams list.">&larr; Save and close</Button>
				<h2 class="text-xl font-semibold">Review Plan: {plan.source_system}</h2>
				{#if saving}<span class="text-xs text-brand-muted">Saving…</span>
				{:else if unsavedCount > 0}
					<span class="text-xs text-severity-warning" title="Decisions taken but not yet saved to the draft">
						{formatCount(unsavedCount)} unsaved
					</span>
				{:else if saveRefused}
					<span class="text-xs text-severity-alarm" title="The server refused the last change; it is not in the draft.">
						not saved
					</span>
				{:else if lastSavedAt}
					<span class="text-xs text-severity-ok" title="Every decision taken is in the draft on the server.">
						Saved at {formatClockTime(lastSavedAt)}
					</span>
				{/if}
			</div>
			<Button
				variant="primary"
				onclick={() => setMode('confirm')}
				disabled={summary.toPair === 0 || blockingGates.length > 0}
				title={blockingGates.length > 0 ? blockingGates.map((g) => `${g.label}: ${g.detail}`).join('; ') : undefined}
				class="px-4 font-semibold"
			>Apply {formatCount(summary.toPair)} pairings &rarr;</Button>
		</div>

		<!-- ── BEFORE YOU APPLY ── One gate per thing the operator can settle, so what stops the
		     apply and what merely informs it are told apart at a glance. The Apply button reads the
		     same list, so the two cannot disagree. -->
		{#if gateItems.length > 0}
			<div class="flex flex-wrap items-center gap-2 rounded-md border border-brand-divider bg-brand-surface px-3 py-2">
				<span class="text-sm font-semibold">Before you apply</span>
				{#each gateItems as g (g.key)}
					<button
						onclick={() => goToGate(g)}
						title={gateHint(g)}
						class="flex items-center gap-1.5 px-2 py-1 rounded text-xs cursor-pointer border {g.state === 'blocking'
							? 'border-severity-warning-border bg-severity-warning-soft text-severity-warning-text font-semibold'
							: g.state === 'done'
								? 'border-brand-divider bg-transparent text-severity-ok'
								: 'border-brand-divider bg-transparent text-brand-muted'}"
					>
						{#if g.state === 'done'}<span aria-hidden="true">&#10003;</span>{/if}
						<span>{g.label}</span>
						<span class="opacity-90">{g.detail}</span>
					</button>
				{/each}
			</div>
		{/if}

		<!-- What the apply will do, where it cannot be missed -->
		<div class="flex flex-wrap items-center gap-2 text-xs">
			<Badge variant="ok">{formatCount(summary.toPair)} to pair</Badge>
			{#if summary.toSkip > 0}<Badge variant="muted">{formatCount(summary.toSkip)} skipped</Badge>{/if}
			<span class="text-brand-muted">will create</span>
			{#if summary.newProjects > 0}<Badge>{summary.newProjects} project{summary.newProjects === 1 ? '' : 's'}</Badge>{/if}
			{#if summary.newSites > 0}<Badge>{summary.newSites} site{summary.newSites === 1 ? '' : 's'}</Badge>{/if}
			{#if summary.newParams > 0}<Badge>{summary.newParams} parameter{summary.newParams === 1 ? '' : 's'}</Badge>{/if}
			{#if plan.summary.instruments_to_create > 0}
				<Badge variant={plan.summary.instruments_unconfirmed > 0 ? 'warning' : 'default'}>
					{plan.summary.instruments_to_create} instrument{plan.summary.instruments_to_create === 1 ? '' : 's'}
				</Badge>
			{/if}
			<!-- Instruments the plan resolves without creating any are still worth stating: silence
			     here read as "this source has no curves", which is a different thing. -->
			{#if boundInstruments > 0}
				<button
					onclick={() => { reviewTab = 'instruments'; }}
					class="bg-transparent border-none p-0 cursor-pointer text-brand-muted underline-offset-2 hover:underline"
				>using {boundInstruments} instrument{boundInstruments === 1 ? '' : 's'}</button>
			{/if}
			{#if summary.newProjects + summary.newSites + summary.newParams + plan.summary.instruments_to_create === 0}
				<span class="text-brand-muted">nothing new</span>
			{/if}
		</div>

		<!-- Curve columns the source declares but never fills: the plan states it rather than
		     leaving the routing block to imply data that will not arrive. -->
		{#each instrumentGroups.filter((g) => g.instrument.stamps_readings && g.instrument.curves.length === 0 && !g.instrument.create) as g (g.key)}
			<p class="text-xs text-brand-muted">
				<span class="font-mono">{g.instrument.curve_column}</span> resolves to
				{g.instrument.name}, which has no curves registered, so no reading from these
				{g.streamCount} stream{g.streamCount === 1 ? '' : 's'} will carry a curve reference.
			</p>
		{/each}

		<div class="space-y-3">
			<!-- View tabs -->
			<div class="flex gap-1 border-b border-brand-divider pb-2">
				{#each [...(planObjects.length > 0 ? [['objects', objectsTabLabel(planObjects.length, openObjects.length)]] : []), ['parameters', `Parameters (${paramGroups.length})`], ['sites', `Sites (${siteGroups.length})`], ['instruments', instrumentsTabLabel], ['curves', `Standard curves (${planInstruments?.curves.length ?? 0})`]] as [t, label]}
					<button
						onclick={() => reviewTab = t as ReviewTab}
						class="px-3 py-1 text-sm rounded-t cursor-pointer border-none {activeTab === t ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted hover:text-brand-text'}"
					>{label}</button>
				{/each}
			</div>

				<!-- ── OBJECTS TAB ── -->
				<!-- What this plan creates, as the objects it creates rather than the rows that name them:
				     one project, a dozen sites and a handful of parameters stand behind a thousand rows,
				     and accepting one here ticks every row it was holding up. -->
				{#if activeTab === 'objects'}
					<div class="rounded-md border border-brand-divider bg-brand-surface p-3 space-y-2">
						<div class="flex flex-wrap items-baseline gap-2">
							<h3 class="text-sm font-semibold">What this plan creates</h3>
							<span class="text-xs text-brand-muted">
								{planObjects.length} object{planObjects.length === 1 ? '' : 's'} behind
								{formatCount(reviewProgress.total)} row{reviewProgress.total === 1 ? '' : 's'},
								{openObjects.length} still to accept
							</span>
							{#if openObjects.length > 0}
								<Button
									size="sm"
									variant="primary"
									class="ml-auto"
									title="Record every object below as accepted and tick the rows that completes"
									onclick={() => acceptObjects(openObjects)}
								>Accept all ({openObjects.length})</Button>
							{/if}
						</div>
						{#if openObjects.length > 0}
							<p class="m-0 rounded border border-severity-warning-border bg-severity-warning-soft px-3 py-2 text-sm text-severity-warning-text">
								Each object has to be accepted before the plan can be applied: a row is only
								ticked once every project, site and parameter it names is accepted, and Apply is
								refused while any row is unticked.
							</p>
						{/if}
						<ul class="list-none p-0 m-0 divide-y divide-brand-divider">
							{#each planObjects as d (d.key)}
								<li class="flex flex-wrap items-center gap-2 py-1.5 text-sm">
									<span class="text-xs uppercase tracking-wide text-brand-muted w-20">{d.kind}</span>
									{#if d.kind === 'project'}
										<span class="font-medium">{d.name}</span>
									{:else}
										<button
											onclick={() => goToObject(d)}
											class="font-medium bg-transparent border-0 border-b border-dashed border-brand-muted cursor-pointer text-brand-text hover:text-brand-primary hover:border-brand-primary p-0"
											title="Open {d.name} on the {d.kind === 'site' ? 'Sites' : 'Parameters'} tab"
										>{d.name}</button>
									{/if}
									<span class="text-xs text-brand-muted">
										named by {formatCount(d.entryCount)} row{d.entryCount === 1 ? '' : 's'}
									</span>
									<Button
										size="sm"
										variant={d.accepted ? 'ghost' : 'primary'}
										class="ml-auto"
										title={acceptHint(d)}
										onclick={() => acceptObject(d)}
									>{d.accepted
										? '✓ accepted'
										: `Accept${d.settles > 0 ? ` (${formatCount(d.settles)} rows)` : ''}`}</Button>
								</li>
							{/each}
						</ul>
					</div>

				<!-- ── INSTRUMENTS TAB ── -->
				<!-- The one place an instrument is chosen. Parameters and Sites mirror what is
				     decided here rather than offering a second editor over the same decision. -->
				{:else if activeTab === 'instruments'}
					<InstrumentsTab
						proposals={plan.instrument_proposals ?? []}
						onadmit={queueProposal}
						{planInstruments}
						{planDevices}
						{instrumentDecisions}
						{openInstrumentQuestions}
						{acceptingSuggestions}
						{instrumentOptions}
						{instrumentValue}
						{instrumentStatus}
						{instrumentRowId}
						onchoose={chooseInstrument}
						onattach={(d, id) => void repointInstrument(d.anchorStreamId, id)}
						onassign={assignInstrumentToRows}
						{labInstruments}
						onacceptall={acceptAllSuggestions}
						nameField={instrumentNameField}
					/>

				<!-- ── STANDARD CURVES TAB ── -->
				{:else if activeTab === 'curves'}
					<CurvesTab
						{planInstruments}
						{labInstruments}
						{plannedInstruments}
						planInstrumentPrefix={PLAN_INSTRUMENT_PREFIX}
						bind:editing={editingCurve}
						bind:editValue={curveEditValue}
						oncommitname={commitCurveName}
						onrehome={rehomeCurve}
					/>

				<!-- ── SITES TAB ── -->
				{:else if activeTab === 'sites'}
					<SitesTab
						{planEntries}
						{siteGroups}
						{filteredGroups}
						{pagedGroups}
						{existingSites}
						{expandedSites}
						{expandedReplicates}
						{existingParams}
						{paramGroups}
						{siteMetadataMap}
						bind:editingParam
						bind:siteSearch
						bind:sitePage
						{totalSitePages}
						bind:reviewFilter
						bind:editingSite
						bind:editValue
						bind:customParamInput
						{matchParam}
						{newParamOption}
						{parseNewParamOption}
						{entryStatus}
						{reviewState}
						{reviewStateLabel}
						{statusLabel}
						{queueUpdate}
						{setEntryAction}
						{setEntryAcknowledged}
						selection={planSelection}
						ontoggleentry={(entry) => (planSelection = toggleSelected(planSelection, entry))}
						onselectallinfilter={() =>
							(planSelection = selectAllInFilter(planSelection, planEntries, reviewFilter))}
						onclearselection={() => (planSelection = clearSelection())}
						onselectdecision={(entries) =>
							(planSelection = selectEntries(planSelection, entries))}
						{labInstruments}
						onbulk={applyBulkDecision}
						{setSiteAction}
						{toggleExpand}
						{startEditSite}
						{commitEditSite}
						{renameSiteGlobal}
						{mapSiteToExisting}
						{goToParam}
						{replicateChip}
						{replicateRouting}
						{valuesChip}
						{streamPreview}
					/>

				<!-- ── PARAMETERS TAB ── -->
				{:else if activeTab === 'parameters'}
					<ParametersTab
						bind:paramPage
						{unitConflicts}
						{paramGroups}
						{existingParams}
						siteCount={siteGroups.length}
						{openInstrumentQuestions}
						{bulkActions}
						{bulkRunning}
						{runBulkAction}
						{deviceParameters}
						{deviceSiteCount}
						{instrumentByParameter}
						{expandedParamGroups}
						{expandedReplicates}
						{groupStatus}
						{rowWarnings}
						{goToInstrument}
						{mapParamToExisting}
						{renameGlobalParam}
						{splitSourceToNewParam}
						{startEditGlobalParam}
						{commitEditGlobalParam}
						{startEditUnits}
						{commitEditUnits}
						bind:editingGlobalParam
						bind:editValue
						bind:editingGlobalUnits
						bind:editUnitsValue
						bind:splitParamInput
						bind:splitParamValue
						bind:editingLabel
						bind:editLabelValue
						{matchParam}
						{newParamOption}
						{parseNewParamOption}
						{startEditLabel}
						{commitEditLabel}
						{setParamGroupAction}
						ongoinstruments={() => { reviewTab = 'instruments'; }}
						{replicateChip}
						{replicateRouting}
					/>
				{/if}
			</div>
		</div>

<!-- ════════════════════ CONFIRM ════════════════════ -->
{:else if mode === 'confirm' && plan}
	<ConfirmStep
		{plan}
		{summary}
		{created}
		onsiteattribute={correctSiteAttribute}
		ongroupattribute={renameProposedGroup}
		{reviewProgress}
		{familySummary}
		instruments={instrumentBindings}
		{openInstrumentQuestions}
		{applying}
		{applyJobId}
		onback={() => setMode('review')}
		onapply={applyPlan}
		ongotoinstruments={() => { setMode('review'); reviewTab = 'instruments'; }}
		ongotosites={(filter) => { reviewFilter = filter; reviewTab = 'sites'; sitePage = 0; setMode('review'); }}
	/>

<!-- ════════════════════ RESULTS ════════════════════ -->
{:else if mode === 'results' && applyResult}
	<ApplyResults
		result={applyResult}
		{reverting}
		ondone={exitWizard}
		onrevert={revertPlan}
	/>
{/if}

<!-- ── Dialogs (always available) ── -->
<Dialog bind:open={pairDialogOpen} title="Pair Stream" maxWidth="sm">
	{#snippet children()}
		{#if pairStream_}
			<div class="space-y-3">
				<div class="text-sm"><span class="text-brand-muted">Stream:</span> <span class="font-mono">{pairStream_.source_key}</span></div>
				<div class="flex flex-col gap-1">
					<label for="sp-select" class="text-sm font-medium">Site Parameter</label>
					<select id="sp-select" bind:value={selectedSiteParam} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
						<option value="">-- Select --</option>
						{#each siteParams as sp}<option value={sp.id}>{siteParamLabel(sp.id)}</option>{/each}
					</select>
				</div>
				<p class="text-xs text-brand-muted">Pairing attributes the stream's whole history to this site and parameter, so its readings enter the charts, the continuous aggregates and, if the slot is public, the public API. An aggregate rebuild runs in the background.</p>
			</div>
		{/if}
	{/snippet}
	{#snippet actions()}
		<Button onclick={() => pairDialogOpen = false}>Cancel</Button>
		<Button variant="primary" onclick={handlePair} disabled={!selectedSiteParam || pairing}>{pairing ? 'Pairing…' : 'Pair'}</Button>
	{/snippet}
</Dialog>

<Dialog bind:open={statsDialogOpen} title="Stream Stats" maxWidth={receipts?.length ? 'sm' : 'xs'}>
	{#snippet children()}
		{#if statsStream}
			<div class="space-y-2 text-sm">
				<div><span class="text-brand-muted">Stream:</span> <span class="font-mono">{statsStream.source_key}</span></div>
				<StreamBrake streamId={statsStream.id} canRelease={canAudit} />
				{#if stats}
					<div class="grid grid-cols-2 gap-2 mt-2">
						<div><span class="text-brand-muted block">Readings</span>{formatCount(stats.reading_count)}</div>
						<div><span class="text-brand-muted block">Latest Value</span>{stats.latest_value ?? '--'}</div>
						<div><span class="text-brand-muted block">Min Time</span><span class="text-xs">{stats.min_time ?? '--'}</span></div>
						<div><span class="text-brand-muted block">Max Time</span><span class="text-xs">{stats.max_time ?? '--'}</span></div>
						{#if stats.withdrawn_count > 0}
							<div><span class="text-brand-muted block">Withdrawn at source</span>{formatCount(stats.withdrawn_count)}</div>
						{/if}
					</div>
				{:else}
					<p class="text-brand-muted">Loading stats…</p>
				{/if}
				{#if receipts?.length}
					<div class="mt-3">
						<span class="text-brand-muted block text-xs mb-1">Reconciliation passes (latest {receipts.length})</span>
						<div class="overflow-x-auto rounded-md border border-brand-divider">
							<table class="w-full text-xs">
								<thead>
									<tr class="bg-brand-bg text-left text-brand-muted">
										<th class="px-2 py-1 font-medium">At</th>
										<th class="px-2 py-1 text-right font-medium">Submitted</th>
										<th class="px-2 py-1 text-right font-medium">New</th>
										<th class="px-2 py-1 text-right font-medium">Changed</th>
										<th class="px-2 py-1 text-right font-medium">Unchanged</th>
										<th class="px-2 py-1 text-right font-medium">Withdrawn</th>
										<th class="px-2 py-1 text-right font-medium">Rejected</th>
										<th class="px-2 py-1 font-medium"></th>
									</tr>
								</thead>
								<tbody>
									{#each receipts as r (r.id)}
										<tr class="border-t border-brand-divider">
											<td class="px-2 py-1 whitespace-nowrap">{formatDateTime(r.at)}</td>
											<td class="px-2 py-1 text-right tabular-nums">{r.submitted}</td>
											<td class="px-2 py-1 text-right tabular-nums">{r.new_rows}</td>
											<td class="px-2 py-1 text-right tabular-nums">{r.changed}</td>
											<td class="px-2 py-1 text-right tabular-nums">{r.unchanged}</td>
											<td class="px-2 py-1 text-right tabular-nums">{r.withdrawn}</td>
											<td class="px-2 py-1 text-right tabular-nums">{r.rejected_total}</td>
											<td class="px-2 py-1">{#if r.braked}<Badge variant="warning">braked</Badge>{/if}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				{/if}
			</div>
		{/if}
	{/snippet}
	{#snippet actions()}
		<Button onclick={() => statsDialogOpen = false}>Close</Button>
	{/snippet}
</Dialog>

<style>
	:global(.flash-highlight) {
		animation: flash-highlight 1.6s ease-out;
	}
	@keyframes flash-highlight {
		0%   { background-color: rgba(199, 119, 0, 0.28); box-shadow: inset 0 0 0 2px rgba(199, 119, 0, 0.6); }
		60%  { background-color: rgba(199, 119, 0, 0.12); box-shadow: inset 0 0 0 2px rgba(199, 119, 0, 0.3); }
		100% { background-color: transparent;             box-shadow: inset 0 0 0 2px transparent; }
	}
</style>
