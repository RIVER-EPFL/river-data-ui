<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { base } from '$app/paths';
	import { beforeNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { listAll } from '$api/paged';
	import { ApiError } from '$api/client';
	import { api, type DataStream, type SiteParameter, type Site, type Parameter, type Project } from '$api/crud';
	import {
		pairStream, unpairStream, getStreamStats, listStreamReceipts, retagStreams, createPairingPlan, updatePairingPlan,
		applyPairingPlan, revertPairingPlan, getUnpairedSummary, getPlanSiteMetadata,
		replicateSpec, getPendingAuditSummary, getChangeProposals, getStreamPreview,
		getPlanInstruments, listPairingPlans, supersedePairingPlan, getPairingPlan, bulkUpdatePairingPlan,
		type PairingPlan, type PairingPlanEntry, type PlanEntryUpdate, type PairingPlanApplyResult, type StreamStats, type SiteMetadata,
		type PlanReplicateSummary, type StreamReceipt, type PlanWarning, type PlanInstrumentRef,
		type PlanInstruments, type PlanInstrumentGroup, type PlanDeviceGroup, type PlanCurveAssignment,
		type PlanHeldCurve,
		type PairingPlanListing,
	type StreamPreview,
	} from '$api/service';
	import { issueSyncCommand, type SyncService } from '$api/service';
	import { getList } from '$api/client';
	import { resyncConfirmation, resyncServiceFor } from '$lib/sync/resync';
	import { me } from '$auth/me.svelte';
	import {
		siteGroups as planSiteGroups,
		familySummary as planFamilySummary,
		paramGroups as planParamGroups,
		parameterIndex,
		instrumentBindings as planInstrumentBindings,
		type InstrumentDecision,
		type InstrumentLabel,
		instrumentCoverage,
		instrumentLabel,
		instrumentRows,
		instrumentsOf,
		isAskingInstrument,
		deviceDecisions,
		suggestionAcceptance,
		creations,
		type ParamGroup,
		type ParamRowKey,
		inParamRow,
		type GroupCreation,
		type SiteCreation,
		type SiteGroup,
	} from '$lib/pairing/planGroups';
	import { toastStore } from '$lib/stores/toast.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import { formatRelativeTime, holdKindBreakdown } from '$lib/utils';
	import { createUrlTab } from '$lib/urlTab.svelte';
	import { createDraftQueue } from '$lib/pairing/draftQueue';
	import { movesPlanInstruments, splitPlanUpdates, type PlanUpdate } from '$lib/pairing/planUpdates';
	import { NO_PLAN_RUNS, planRunLabel, runsAfterJob, type PlanRuns, type PlanRunProgress } from '$lib/pairing/planRuns';
	import { eventBus } from '$lib/stores/events.svelte';
	import { objectDecisions, type ObjectDecision } from '$lib/pairing/objectDecisions';
	import { curveReviewBlocked, curveRows, type CurveRow } from '$lib/pairing/curveRows';
	import { activeReviewTab, type ReviewTab } from '$lib/pairing/reviewTabs';
	import PairSkipToggle from '$components/ui/PairSkipToggle.svelte';
	import MappingSelect, { type MappingGroup } from '$components/ui/MappingSelect.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import ConfirmButton from '$components/ui/ConfirmButton.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import StreamBrake from '$components/streams/StreamBrake.svelte';
	import { formatClockTime, formatDateTime, formatSignificant } from '$lib/utils';
	import Button from '$components/ui/Button.svelte';
	import PaginationControls from '$components/ui/PaginationControls.svelte';
	import Tabs from '$components/ui/Tabs.svelte';
	import ReplicateFamilyBadge from '$components/streams/ReplicateFamilyBadge.svelte';
	import ChangeProposalsPanel from '$components/logs/ChangeProposalsPanel.svelte';
	import ReplicateAuditsPanel from '$components/logs/ReplicateAuditsPanel.svelte';
	import DiscrepancyBrowse from '$components/logs/DiscrepancyBrowse.svelte';
	import { readTagParams } from '$lib/discrepancies';
	import { AUDIT_QUEUE_KINDS } from '$lib/holds';
	import SyncServicesPanel from '$components/sync/SyncServicesPanel.svelte';
	import { legacyInstrumentTabHref } from '$lib/instruments/inspection';
	import { formatCount } from '$lib/format';
	import ConfirmStep from '$components/pairing/ConfirmStep.svelte';
	import ApplyResults from '$components/pairing/ApplyResults.svelte';
	import CurvesTab from '$components/pairing/CurvesTab.svelte';
	import ProjectsTab from '$components/pairing/ProjectsTab.svelte';
	import InstrumentsTab from '$components/pairing/InstrumentsTab.svelte';
	import ParametersTab from '$components/pairing/ParametersTab.svelte';
	import { REVIEW_ROWS_PER_PAGE, type ReviewFilter } from '$components/pairing/ReviewTable.svelte';
	import { applyBlockedReason, planGateItems } from '$lib/pairing/applyGate';
	import { conflictsOn, planConflicts, resolutionOf } from '$lib/pairing/conflicts';
	import SitesTab from '$components/pairing/SitesTab.svelte';
	import { chunked } from '$lib/pairing/chunked';

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
	const canAudit = $derived(me.can('manageSensors'));
	const isAdmin = $derived(me.can('admin'));
	const streamLink = ['list_filter', 'q', 'stats'].some((name) => page.url.searchParams.has(name));
	const requestedListTab = page.url.searchParams.get('tab');
	const tab = createUrlTab({
		keys: ['pair', 'streams', 'review', 'services'],
		aliases: { audits: 'review', discrepancies: 'review' },
		initial: streamLink ? 'streams' : 'pair',
	});
	let reviewSectionIndex = $state(
		requestedListTab === 'discrepancies' || page.url.searchParams.get('review') === 'discrepancies' ? 1 : 0,
	);
	const reviewSection = $derived(reviewSectionIndex === 1 ? 'discrepancies' : 'actionable');
	$effect(() => {
		const section = reviewSection;
		if (tab.key !== 'review') return;
		untrack(() => {
			if (page.url.searchParams.get('review') === section) return;
			tab.go('review', (url) => url.searchParams.set('review', section));
		});
	});
	$effect(() => {
		const requestedTab = page.url.searchParams.get('tab');
		const requestedSection = page.url.searchParams.get('review');
		untrack(() => {
			if (requestedTab === 'discrepancies') reviewSectionIndex = 1;
			else if (requestedSection === 'actionable' || requestedSection === 'discrepancies') {
				reviewSectionIndex = requestedSection === 'discrepancies' ? 1 : 0;
			}
		});
	});
	const auditQueue = $derived(pendingAudits + pendingProposals);
	const tabLabels = $derived(
		canAudit
			? [
					'Discover & Pair',
					'Streams',
					auditQueue > 0 ? `Review (${auditQueue})` : 'Review',
					...(isAdmin ? ['Services'] : []),
				]
			: ['Discover & Pair', 'Streams'],
	);

	onMount(() => {
		const destination = legacyInstrumentTabHref(page.url.searchParams.get('tab'), base);
		if (destination) void goto(destination, { replaceState: true });
	});
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
			const [summary, proposals] = await Promise.allSettled([
				getPendingAuditSummary(AUDIT_QUEUE_KINDS),
				getChangeProposals({ status: 'pending', page: 1, perPage: 1 }),
			]);
			if (summary.status === 'fulfilled') {
				pendingAudits = summary.value.pending;
				pendingByKind = summary.value.byKind;
			}
			if (proposals.status === 'fulfilled') pendingProposals = proposals.value.total;
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
	// What the plan's own job last reported, so its row names the phase rather than a verb that
	// stands from the enqueue to the last slot.
	let planRunProgress = $state<PlanRunProgress | null>(null);
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
	// One search, filter and page, for whichever tab is open. A tab change starts them afresh.
	let tableQuery = $state(reviewParam('q') ?? '');
	let tableFilter = $state<ReviewFilter>((reviewParam('filter') as ReviewFilter) ?? 'all');
	let tablePage = $state(Math.max(0, Number(reviewParam('page') ?? '1') - 1) || 0);
	let expandedSites = $state<Set<string>>(new Set());
	let expandedParamGroups = $state<Set<string>>(new Set());
	let splitParamInput = $state<{ groupName: string; sourceName: string } | null>(null);
	let splitParamValue = $state('');
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
		const filter = tableFilter;
		const search = tableQuery;
		const pageNo = tablePage;
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
	const planDeviceDecisions = $derived(deviceDecisions(planDevices));
	// The Instruments tab's rows, and how every other tab names the row a stream belongs to.
	const instrumentRowList = $derived(instrumentRows(planDevices, planDeviceDecisions, instrumentDecisions));
	const instrumentLabels = $derived(new Map(instrumentRowList.map((r) => [r.key, instrumentLabel(r)])));
	const coverage = $derived(instrumentCoverage(planEntries));
	const entryById = $derived(new Map(planEntries.map((e) => [e.stream_id, e])));

	// Empty while the instruments load, so no tab reads a stream as having none.
	function instrumentsFor(streamIds: string[]): InstrumentLabel[] {
		if (!planInstruments) return [];
		const entries = streamIds.map((id) => entryById.get(id)).filter((e): e is PairingPlanEntry => !!e);
		return instrumentsOf(entries, instrumentLabels);
	}

	// One instrument opens on its row; several open the tab searched for what they measure.
	function goToInstruments(instruments: InstrumentLabel[], query: string) {
		openTab('instruments');
		if (instruments.length !== 1) {
			tableQuery = query;
			tablePage = 0;
			return;
		}
		const at = instrumentRowList.findIndex((r) => r.key === instruments[0].key);
		if (at >= 0) tablePage = Math.floor(at / REVIEW_ROWS_PER_PAGE);
		flashTo(instrumentRowId(instruments[0].key));
	}

	const openInstrumentQuestions = $derived(
		[...instrumentDecisions, ...planDeviceDecisions].filter(isAskingInstrument).length,
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
	// also how an attach is undone, since naming one proposes it).
	function chooseInstrument(d: InstrumentDecision, value: string) {
		if (value.startsWith('db:')) {
			void repointInstrument(d.anchorStreamId, value.slice(3));
			return;
		}
		if (value.startsWith('new:')) void proposeInstrument(d.anchorStreamId, value.slice(4));
	}

	// An instrument scope carries the source's own key, which may hold spaces ("metalp:chla acid"),
	// and an element id may not. One helper builds the id and reads it back, so they cannot drift.
	const instrumentRowId = (key: string) => `instrument-row-${key.replace(/\s+/g, '-')}`;

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
	const paramGroups = $derived(planParamGroups(planEntries));

	// What the plan cannot apply as it stands, as against what is still to review: the rows carry it
	// already, and the gate reads the same list.
	const conflicts = $derived(planConflicts(planEntries));

	function rowWarnings(pg: ParamGroup): string[] {
		return pg.warnings;
	}

	function conflictsNamed(tab: ReviewTab, subject: string): string[] {
		return conflictsOn(conflicts, tab)
			.filter((c) => c.subject.toLowerCase() === subject.toLowerCase())
			.map((c) => c.message);
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

	// Moves the local entries and sends the updates in requests that stay under the body limit.
	async function sendEntryUpdates(updates: PlanEntryUpdate[]) {
		for (const update of updates) {
			const entry = planEntries.find((e) => e.stream_id === update.stream_id);
			if (!entry) continue;
			if (update.action != null) entry.action = update.action;
			if (update.acknowledged != null) entry.acknowledged = update.acknowledged;
		}
		planEntries = [...planEntries];
		for (const batch of chunked(updates)) {
			queueUpdate(batch, { immediate: true });
			await flushUpdates();
		}
	}

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

	// A held curve is created on apply, under whichever instrument it is attached to, so the
	// attachment is a decision on the plan like every other one and goes through the same queue.
	async function attachHeldCurve(curve: PlanHeldCurve, target: string) {
		if (!plan) return;
		const planned = target.startsWith(PLAN_INSTRUMENT_PREFIX)
			? target.slice(PLAN_INSTRUMENT_PREFIX.length)
			: null;
		draftQueue.enqueue(
			[
				{
					proposal_id: curve.id,
					instrument_source_key: planned,
					instrument_id: planned || !target ? null : target,
				},
			],
			{ immediate: true },
		);
		await draftQueue.flush().catch(() => {});
		await loadPlanInstruments();
	}

	// A skip is the other decision a held curve takes, and it goes through the same queue as the
	// attachment: the curve is not created and the readings naming it are not imported (Q220).
	async function skipHeldCurve(curve: PlanHeldCurve, skip: boolean) {
		if (!plan) return;
		draftQueue.enqueue([{ proposal_id: curve.id, skip }], { immediate: true });
		await draftQueue.flush().catch(() => {});
		await loadPlanInstruments();
	}

	// The instruments this plan will create, one option each however many parameters share one.
	const plannedInstruments = $derived.by(() => {
		const seen = new Map<string, string>();
		for (const g of planInstruments?.groups ?? []) {
			if (g.create && !seen.has(g.source_key)) seen.set(g.source_key, g.name);
		}
		return [...seen.entries()].map(([sourceKey, name]) => ({ sourceKey, name }));
	});

	// The curve name editor: one open at a time, Enter commits, Escape abandons.
	let editingCurve = $state<string | null>(null);
	let curveEditValue = $state('');

	// Naming an instrument is what creates it: the plan carries the proposal, the apply mints it,
	// and every stream in the scope moves with it.
	async function proposeInstrument(anchorStreamId: string, name: string) {
		if (!name.trim()) return;
		queueUpdate([{ stream_id: anchorStreamId, instrument_name: name.trim(), instrument_confirmed: true }]);
		try { await flushUpdates(); } catch { /* the toast from the failed flush is the signal */ }
		await loadPlanInstruments();
	}

	// Accepts every suggestion still asking. A suggestion whose name is already an instrument's is
	// left for a person, since attaching and a second instrument are both answers.
	async function acceptAllSuggestions(): Promise<PlanEntryUpdate[]> {
		const { updates, held } = suggestionAcceptance([...instrumentDecisions, ...planDeviceDecisions]);
		if (held > 0) {
			toastStore.info(
				`${held} suggestion${held === 1 ? '' : 's'} left for you: the name is already an instrument, so attaching or creating a second one is your call.`,
			);
		}
		if (updates.length === 0) return [];
		queueUpdate(updates);
		await flushUpdates();
		await loadPlanInstruments();
		return updates.map((u) => ({ stream_id: u.stream_id, instrument_confirmed: true }));
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
		for (const row of paramRowsNamed(w.paramName)) renameGlobalParam(row, newName, units);
	}

	// The code is taken, and attaching is the other way out: the plan's own rows keep their units,
	// and the catalog parameter they join keeps its.
	function attachToCatalogParam(w: { warning: PlanWarning; paramName: string }) {
		const existing = w.warning.existing;
		if (!existing) return;
		for (const row of paramRowsNamed(w.paramName)) mapParamToExisting(row, existing);
	}

	// Every parameter row carrying this code: a warning names the code, and one code can be two rows
	// while their units disagree.
	function paramRowsNamed(name: string): ParamRowKey[] {
		const seen = new Set<string>();
		const rows: ParamRowKey[] = [];
		for (const e of planEntries) {
			if (e.parameter.name !== name || seen.has(e.parameter.units)) continue;
			seen.add(e.parameter.units);
			rows.push({ name, units: e.parameter.units });
		}
		return rows;
	}

	function goToParam(paramName: string) {
		openTab('parameters');
		const at = paramGroups.findIndex((pg) => pg.name === paramName);
		if (at >= 0) tablePage = Math.floor(at / REVIEW_ROWS_PER_PAGE);
		flashTo(`param-row-${paramName}`);
	}

	function openTab(tab: ReviewTab) {
		if (tab !== activeTab) {
			tableQuery = '';
			tableFilter = 'all';
			tablePage = 0;
		}
		reviewTab = tab;
	}

	// A site named on the object card: the filter and search are cleared first, since a site the
	// reader asked for must not be hidden by a filter they set for something else.
	function goToSite(siteName: string) {
		openTab('sites');
		const at = siteGroups.findIndex((g) => g.siteName === siteName);
		if (at >= 0) tablePage = Math.floor(at / REVIEW_ROWS_PER_PAGE);
		expandedSites = new Set(expandedSites).add(siteName);
		flashTo(`site-row-${siteName}`);
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

	function renameGlobalParam(row: ParamRowKey, newName: string, newUnits?: string) {
		if (!newName.trim()) return;
		if (newName === row.name && newUnits === undefined) return;
		const updates: PlanEntryUpdate[] = [];
		for (const e of planEntries) {
			if (inParamRow(e, row)) {
				e.parameter.name = newName.trim();
				e.parameter.create = true;
				e.parameter.id = null;
				// A code somebody typed creates a parameter; joining the catalog is a choice of its
				// own, made by picking the parameter from the list.
				e.parameter.attach = { choice: 'new' };
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

	function mapParamToExisting(row: ParamRowKey, existingParam: { id: string; code: string }) {
		const updates: PlanEntryUpdate[] = [];
		for (const e of planEntries) {
			if (inParamRow(e, row)) {
				e.parameter.name = existingParam.code;
				e.parameter.id = existingParam.id;
				e.parameter.create = false;
				e.parameter.attach = { choice: 'existing', id: existingParam.id };
				updates.push({
					stream_id: e.stream_id,
					parameter_name: existingParam.code,
					parameter_attach: { choice: 'existing', id: existingParam.id },
				});
			}
		}
		planEntries = [...planEntries];
		queueUpdate(updates);
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
	let editingLabel = $state<ParamRowKey | null>(null);
	let editLabelValue = $state('');

	function startEditLabel(pg: { name: string; units: string; label: string | null }) {
		editingLabel = { name: pg.name, units: pg.units };
		editLabelValue = pg.label ?? '';
	}

	function focusOnMount(node: HTMLInputElement) {
		node.focus();
	}

	function commitEditLabel() {
		if (editingLabel === null) return;
		const row = editingLabel;
		const newLabel = editLabelValue.trim();
		editingLabel = null;
		if (!newLabel) return;
		const updates: PlanEntryUpdate[] = [];
		for (const e of planEntries) {
			if (inParamRow(e, row) && (e.parameter.label ?? '') !== newLabel) {
				e.parameter.label = newLabel;
				updates.push({ stream_id: e.stream_id, parameter_label: newLabel });
			}
		}
		if (updates.length === 0) return;
		planEntries = [...planEntries];
		queueUpdate(updates);
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
					split.heldCurves,
				);
				if (editGeneration === generation) {
					plan = updated;
					planEntries = [...updated.entries];
				} else {
					// The snapshot is stale, but its version is what the next write must name.
					plan = { ...plan, version: updated.version };
				}
				if (movesPlanInstruments(batch)) await loadPlanInstruments();
			} catch (e) {
				// Someone else edited the draft: reload it so the retry writes against what is
				// there now, rather than losing this batch or theirs.
				if (e instanceof ApiError && e.status === 409) {
					try {
						const reloaded = await getPairingPlan(plan.id);
						plan = reloaded;
						planEntries = [...reloaded.entries];
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

	// ── Reviews ──
	// A project or parameter is reviewed once however many rows name it; the plan records the key.
	// The overlay is this session's clicks before their PATCH has come back.
	let objectOverlay = $state<Map<string, boolean>>(new Map());
	const reviewedKeys = $derived.by(() => {
		const keys = new Set((plan?.accepted_objects ?? []).map((a) => a.key));
		for (const [key, reviewed] of objectOverlay) {
			if (reviewed) keys.add(key);
			else keys.delete(key);
		}
		return keys;
	});
	const planProjects = $derived(objectDecisions(planEntries, 'project', reviewedKeys));
	const planParameters = $derived(objectDecisions(planEntries, 'parameter', reviewedKeys));
	const planCurves = $derived(curveRows(planInstruments, reviewedKeys));

	function reviewProject(project: ObjectDecision, reviewed: boolean) {
		queueObject(project.key, reviewed);
	}

	function reviewParameter(name: string, reviewed: boolean) {
		queueObject(`parameter:${name}`, reviewed);
	}

	// A curve is reviewed on the instrument it sits on; a held one waits until it has one.
	function reviewCurve(row: CurveRow, reviewed: boolean) {
		if (curveReviewBlocked(row)) return;
		queueObject(row.key, reviewed);
	}

	// "Mark all reviewed" and "Mark all unreviewed" act on the open tab only, and the toast carries
	// the writes that undo them.
	let markingReviewed = $state(false);

	async function markTabReviewed(reviewed: boolean) {
		if (!plan || markingReviewed) return;
		markingReviewed = true;
		try {
			const undo = await markReviewed(activeTab, reviewed);
			if (undo) toastStore.success(undo.message, { label: 'Undo', run: () => void undo.run() });
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'The review was not saved');
		} finally {
			markingReviewed = false;
		}
	}

	/** Instruments the review settled that it can take back: an existing one is not a proposal. */
	const confirmedProposals = $derived(
		[...instrumentDecisions, ...planDeviceDecisions].filter((d) => d.group?.create && d.group.confirmed),
	);

	function markedMessage(count: number, noun: string, reviewed: boolean): string {
		return `Marked ${formatCount(count)} ${noun}${count === 1 ? '' : 's'} ${reviewed ? 'reviewed' : 'unreviewed'}`;
	}

	async function markReviewed(
		tab: ReviewTab,
		reviewed: boolean,
	): Promise<{ message: string; run: () => Promise<void> } | null> {
		if (!plan) return null;
		if (tab === 'projects' || tab === 'parameters' || tab === 'curves') {
			const objects: Array<{ key: string; reviewed: boolean }> =
				tab === 'projects' ? planProjects
				: tab === 'parameters' ? planParameters
				: planCurves.filter((r) => curveReviewBlocked(r) === null);
			const moved = objects.filter((o) => o.reviewed !== reviewed);
			if (moved.length === 0) return null;
			for (const o of moved) queueObject(o.key, reviewed);
			await flushUpdates();
			return {
				message: markedMessage(moved.length, tab === 'projects' ? 'project' : tab === 'parameters' ? 'parameter' : 'curve', reviewed),
				run: async () => {
					for (const o of moved) queueObject(o.key, !reviewed);
					await flushUpdates();
				},
			};
		}
		if (tab === 'sites') {
			const moved = planEntries.filter((e) => e.action === 'pair' && (e.acknowledged ?? false) !== reviewed);
			if (moved.length === 0) return null;
			const sites = new Set(moved.map((e) => e.site.name)).size;
			await flushUpdates();
			// One predicate rather than a row each: a NOMIS plan is 29,400 rows.
			const updated = await bulkUpdatePairingPlan(plan.id, plan.version, {
				where: { action: 'pair' },
				acknowledged: reviewed,
			});
			plan = updated;
			planEntries = [...updated.entries];
			editGeneration++;
			return {
				message: markedMessage(sites, 'site', reviewed),
				run: () => sendEntryUpdates(moved.map((e) => ({ stream_id: e.stream_id, acknowledged: !reviewed }))),
			};
		}
		if (tab === 'instruments') {
			let updates: PlanEntryUpdate[];
			if (reviewed) {
				updates = await acceptAllSuggestions();
			} else {
				updates = confirmedProposals.map((d) => ({ stream_id: d.anchorStreamId, instrument_confirmed: false }));
				if (updates.length > 0) {
					await sendEntryUpdates(updates);
					await loadPlanInstruments();
				}
			}
			if (updates.length === 0) return null;
			return {
				message: markedMessage(updates.length, 'instrument', reviewed),
				run: async () => {
					await sendEntryUpdates(updates.map((u) => ({ stream_id: u.stream_id, instrument_confirmed: !reviewed })));
					await loadPlanInstruments();
				},
			};
		}
		return null;
	}

	// Reviewing an instrument confirms what the plan proposes for it; an existing one has nothing to confirm.
	async function reviewInstrument(d: InstrumentDecision, reviewed: boolean) {
		const update: PlanEntryUpdate = reviewed
			? suggestionAcceptance([d]).updates[0]
			: { stream_id: d.anchorStreamId, instrument_confirmed: false };
		if (!update) return;
		queueUpdate([update]);
		try { await flushUpdates(); } catch { /* the toast from the failed flush is the signal */ }
		await loadPlanInstruments();
	}

	// A site is reviewed when every row it pairs is.
	function reviewSite(group: SiteGroup, reviewed: boolean) {
		const changed = group.entries.filter((e) => e.action !== 'skip' && (e.acknowledged ?? false) !== reviewed);
		if (changed.length === 0) return;
		for (const e of changed) e.acknowledged = reviewed;
		planEntries = [...planEntries];
		queueUpdate(
			changed.map((e) => ({ stream_id: e.stream_id, acknowledged: reviewed })),
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

	function renameSiteGlobal(oldName: string, newName: string) {
		const entries = planEntries.filter((e) => e.site.name === oldName);
		const updates: PlanEntryUpdate[] = entries.map((e) => ({ stream_id: e.stream_id, site_name: newName }));
		for (const e of entries) { e.site.name = newName; e.site.create = true; e.site.id = null; }
		planEntries = [...planEntries];
		queueUpdate(updates);
	}

	// The server matches the new name against the catalog, so naming an existing project pairs onto it.
	function renameProject(oldName: string, newName: string) {
		const name = newName.trim();
		if (!name || name === oldName) return;
		const entries = planEntries.filter((e) => e.project.name === oldName);
		for (const e of entries) {
			const existing = existingProjects.find((p) => p.name.toLowerCase() === name.toLowerCase());
			e.project.name = existing?.name ?? name;
			e.project.id = existing?.id ?? null;
			e.project.create = !existing;
		}
		planEntries = [...planEntries];
		queueUpdate(entries.map((e) => ({ stream_id: e.stream_id, project_name: e.project.name })));
	}

	function mapSiteToExisting(oldName: string, existingSite: Site) {
		renameSiteGlobal(oldName, existingSite.name);
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
				siteParams.length === 0 ? listAll(api.siteParameters) : Promise.resolve(null),
				sites.length === 0 ? listAll(api.sites) : Promise.resolve(null),
				params.length === 0 ? listAll(api.parameters) : Promise.resolve(null),
			]);
			streams = result.data;
			total = result.total;
			if (spResult) siteParams = spResult;
			if (sResult) sites = sResult;
			if (pResult) params = pResult;
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
	let sourceSelectLoaded = $state(false);
	const draftFor = (sourceSystem: string) =>
		openDrafts.find((d) => d.source_system === sourceSystem);
	const appliedFor = (sourceSystem: string) =>
		appliedPlans.find((p) => p.source_system === sourceSystem);

	async function enterSourceSelect() {
		tab.go('pair', (url) => {
			url.searchParams.delete('step');
			url.searchParams.delete('plan');
		});
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
		finally { planLoading = false; sourceSelectLoaded = true; }
	}

	let existingParams = $state<Parameter[]>([]);
	let existingSites = $state<Site[]>([]);
	let existingProjects = $state<Project[]>([]);
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
			const [loaded, paramResult, siteResult, instrumentResult, projectResult] = await Promise.all([
				loadPlan(),
				listAll(api.parameters),
				listAll(api.sites),
				api.sensors.list({ perPage: 500, filter: { is_lab_instrument: true } }),
				listAll(api.projects),
			]);
			labInstruments = instrumentResult.data.map((s) => ({
				id: s.id,
				name: s.name ?? null,
				serial_number: s.serial_number ?? null,
			}));
			plan = loaded;
			planEntries = [...loaded.entries];
			params = paramResult;
			sites = siteResult;
			existingParams = params;
			existingSites = sites;
			existingProjects = projectResult;
			expandedSites = new Set();
			expandedReplicates = new Set();
			lastSavedAt = null;
			saveRefused = false;
			objectOverlay = new Map();
			// A resumed review keeps the position the URL carries; a new plan starts at the top.
			if (!resuming) {
				tableQuery = '';
				tableFilter = 'all';
				tablePage = 0;
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
			planRunProgress = null;
			toastStore.success('Applying the plan: it pairs the streams, then re-derives the slots they feed. Its progress is in the operations panel; the counts appear here when it finishes.');
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
			planRunProgress = null;
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
	let unsubJobProgress: (() => void) | null = null;
	onMount(() => {
		unsubJobCompleted = eventBus.subscribe('job_completed', (event) => {
			const finished = (event as { job_id: string }).job_id;
			const after = runsAfterJob(planRuns, finished);
			if (after === planRuns) return;
			planRuns = after;
			planRunProgress = null;
			if (mode === 'source-select') void loadSourceSelect();
		});
		unsubJobProgress = eventBus.subscribe('job_progress', (event) => {
			const update = event as { job_id: string; status: string; progress: number | null; total: number | null };
			if (update.job_id !== planRuns.applyJobId && update.job_id !== planRuns.revertJobId) return;
			planRunProgress = { status: update.status, progress: update.progress, total: update.total };
		});
	});

	const reviewCount = <T,>(items: T[], reviewed: (item: T) => boolean) => ({
		reviewed: items.filter(reviewed).length,
		total: items.length,
	});

	// The review's tabs, read by both the tab strip and the Apply button.
	const gateItems = $derived(
		planGateItems({
			projects: reviewCount(planProjects, (p) => p.reviewed),
			sites: reviewCount(
				siteGroups.filter((g) => g.pairCount > 0),
				(g) => g.entries.every((e) => e.action === 'skip' || e.acknowledged === true),
			),
			parameters: reviewCount(planParameters, (p) => p.reviewed),
			instruments: {
				reviewed: instrumentDecisions.length + planDeviceDecisions.length - openInstrumentQuestions,
				total: instrumentDecisions.length + planDeviceDecisions.length,
			},
			curves: reviewCount(planCurves, (r) => r.reviewed),
			conflicts: {
				projects: conflictsOn(conflicts, 'projects').map((c) => c.message),
				sites: conflictsOn(conflicts, 'sites').map((c) => c.message),
				parameters: conflictsOn(conflicts, 'parameters').map((c) => c.message),
			},
		}),
	);
	const applyBlocked = $derived(applyBlockedReason(gateItems));
	const activeTab = $derived(activeReviewTab(reviewTab, gateItems));
	onDestroy(() => { unsubJobCompleted?.(); unsubJobProgress?.(); });

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
		if (mode === 'source-select') {
			setMode('list');
			await loadSourceSelect();
		}
		else if (mode === 'review' && resumeId && !plan) await resumePlan(resumeId);
		else if (mode === 'review' && !resumeId) setMode('list');
		// The same for ?step=results&plan=<id>: the counts belong to the plan, not to the call
		// that started the job, so they survive the tab that started it.
		else if (mode === 'results' && resumeId && !applyResult) await openResults(resumeId);
		else if (mode === 'results' && !resumeId) setMode('list');
	});

	$effect(() => {
		if (mode === 'list' && tab.key === 'pair' && !sourceSelectLoaded && !planLoading) {
			void loadSourceSelect();
		}
	});
</script>

<!-- A source parameter the catalog already holds, or holds under other units, with the way out,
     beside the parameters it is about rather than above the whole review. -->
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
					{#if resolutionOf(w.warning.kind) === 'attach'}
						<Button size="sm" onclick={() => attachToCatalogParam(w)}>Attach to {ex.code}</Button>
					{:else if resolutionOf(w.warning.kind) === 'units'}
						<Button size="sm" onclick={() => adoptCatalogUnits(w)}>Keep catalog units ({ex.units})</Button>
						<Button size="sm" onclick={() => adoptSourceUnits(w)}>Use source units ({w.warning.source_units})</Button>
					{/if}
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
<svelte:head><title>Sync services | RIVER Data</title></svelte:head>

<!-- ════════════════════ STREAM LIST MODE ════════════════════ -->
{#if mode === 'list'}
	<div class="space-y-4">
		<h2 class="text-xl font-semibold">Sync services</h2>

		<Tabs tabs={tabLabels} bind:active={tab.index} />

		{#if tab.key === 'pair'}
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
												<ConfirmButton label="Start over" confirmLabel="Click again to start over" consequence="The open draft keeps its decisions but can no longer be applied" onconfirm={() => startOverPlan(draft)} />
												<ConfirmButton label="Discard" confirmLabel="Click again to discard" consequence="Its decisions are lost and its streams stay unpaired" onconfirm={() => discardPlan(draft)} />
											{:else}
												<Button size="sm" onclick={(e) => { e.stopPropagation(); createPlan(s.source_system); }}>Discover</Button>
											{/if}
											{#if appliedFor(s.source_system)}
												{@const done = appliedFor(s.source_system)}
												<Button size="sm" variant="ghost" onclick={(e) => { e.stopPropagation(); openResults(done!.id); }}>
													{#if done!.id === applyingPlanId}{planRunLabel('apply', planRunProgress)}{:else if done!.id === revertingPlanId}{planRunLabel('revert', planRunProgress)}{:else}Results{/if}
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
					<p class="text-sm"><a class="text-brand-primary" href="{base}/streams?tab=services">Check service status</a></p>
				{:else}
					<p class="text-severity-ok">All streams are paired.</p>
				{/if}
				{#if fullyPaired.length > 0}
					<p class="text-xs text-brand-muted">{fullyPaired.map((s) => s.source_system).join(', ')} -- fully paired ({formatCount(fullyPaired.reduce((a, s) => a + s.paired, 0))} streams)</p>
				{/if}
			{/if}
		{:else if tab.key === 'review' && canAudit}
			<Tabs tabs={['Actionable', 'Discrepancies (informational)']} bind:active={reviewSectionIndex} />
			{#if reviewSection === 'actionable'}
				<p class="text-sm text-brand-muted">
					Decide changed source values and review holds that require an operator.
				</p>
				<div class="space-y-4">
					<ChangeProposalsPanel onPendingChange={(n) => (pendingProposals = n)} />
					<ReplicateAuditsPanel
						initialView={page.url.searchParams.get('view') === 'resolved' ? 'resolved' : 'review'}
						initialHoldId={page.url.searchParams.get('holds_id') ?? undefined}
						onPendingChange={(n) => (pendingAudits = n)}
					/>
				</div>
			{:else}
				<p class="text-sm text-brand-muted">
					Imports recorded these discrepancies with their readings for reference. Nothing here
					needs an action.
				</p>
				<DiscrepancyBrowse initial={readTagParams(page.url.searchParams)} />
			{/if}
		{:else if tab.key === 'services' && isAdmin}
		<SyncServicesPanel />
		{:else}

		{#if auditQueue > 0 && canAudit}
			<div class="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-severity-warning-soft border border-severity-warning-border text-sm text-severity-warning-text">
				<span>{auditQueue} item{auditQueue === 1 ? '' : 's'} need{auditQueue === 1 ? 's' : ''} review{auditBreakdown ? ` · ${auditBreakdown}` : ''}</span>
				<button
					onclick={() =>
						tab.go('review', (url) => url.searchParams.set('review', 'actionable'), {
							push: true,
						})}
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
			<ErrorNotice message={error} />
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
									{#if stream.sensor_id}
										<a
											href="{base}/sensors/{stream.sensor_id}?tab=curves"
											class="ml-2 text-brand-primary no-underline hover:underline"
										>Instrument</a>
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

		<PaginationControls {total} page={currentPage} {perPage} onPageChange={(p) => { currentPage = p; load(); }} />

		{/if}
	</div>

<!-- ════════════════════ SOURCE SELECT ════════════════════ -->
{:else if mode === 'source-select'}
	<p class="text-brand-muted">Loading sources…</p>

<!-- ════════════════════ PLAN REVIEW ════════════════════ -->
{:else if mode === 'review' && plan}
	<div class="space-y-4">
		<!-- Header -->
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3">
				<Button variant="ghost" size="sm" onclick={exitWizard} class="text-brand-primary" title="Every decision is saved to the draft. Discard it from its row on the streams list.">&larr; Go back and resume later</Button>
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
				disabled={summary.toPair === 0 || applyBlocked !== null}
				title={summary.toPair === 0 ? 'This plan pairs nothing' : (applyBlocked ?? undefined)}
				class="px-4 font-semibold"
			>Apply plan &rarr;</Button>
		</div>

		<div class="space-y-3">
			<!-- View tabs, each carrying its review count. -->
			<div class="flex flex-wrap items-center gap-1 border-b border-brand-divider pb-2">
				{#each gateItems as g (g.tab)}
					<button
						onclick={() => openTab(g.tab)}
						class="flex items-center gap-1.5 px-3 py-1 text-sm rounded-t cursor-pointer border-none {activeTab === g.tab ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted hover:text-brand-text'}"
					>
						{#if g.state === 'blocking'}
							<span aria-hidden="true" class="size-2 rounded-full bg-severity-warning-fill"></span>
						{:else if g.state === 'done'}
							<span aria-hidden="true" class="size-2 rounded-full bg-severity-ok-fill"></span>
						{/if}
						<span class="{g.state === 'blocking' ? 'font-semibold' : ''}">{g.label}</span>
						<span class="text-xs opacity-90">{g.detail}</span>
					</button>
				{/each}
			</div>

				{#if activeTab === 'projects'}
					<ProjectsTab
						projects={planProjects}
						{existingProjects}
						onreview={reviewProject}
						onrename={renameProject}
						projectConflicts={(name) => conflictsNamed('projects', name)}
						bind:query={tableQuery}
						bind:filter={tableFilter}
						bind:page={tablePage}
						onmarkall={markTabReviewed}
						marking={markingReviewed}
					/>

				<!-- ── INSTRUMENTS TAB ── -->
				<!-- The one place an instrument is chosen. Parameters and Sites mirror what is
				     decided here rather than offering a second editor over the same decision. -->
				{:else if activeTab === 'instruments'}
					<InstrumentsTab
						proposals={plan.instrument_proposals ?? []}
						onadmit={queueProposal}
						{planInstruments}
						{planDevices}
						deviceDecisions={planDeviceDecisions}
						{instrumentDecisions}
						{instrumentOptions}
						{instrumentValue}
						{instrumentStatus}
						{instrumentRowId}
						{coverage}
						{goToParam}
						{goToSite}
						onchoose={chooseInstrument}
						onattach={(d, id) => void repointInstrument(d.anchorStreamId, id)}
						onreview={reviewInstrument}
						canMarkUnreviewed={confirmedProposals.length > 0}
						bind:query={tableQuery}
						bind:filter={tableFilter}
						bind:page={tablePage}
						onmarkall={markTabReviewed}
						marking={markingReviewed}
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
						onattach={attachHeldCurve}
						onskip={skipHeldCurve}
						{reviewedKeys}
						onreview={reviewCurve}
						bind:query={tableQuery}
						bind:filter={tableFilter}
						bind:page={tablePage}
						onmarkall={markTabReviewed}
						marking={markingReviewed}
					/>

				<!-- ── SITES TAB ── -->
				{:else if activeTab === 'sites'}
					<SitesTab
						{planEntries}
						{siteGroups}
						siteConflicts={(name) => conflictsNamed('sites', name)}
						{existingSites}
						{expandedSites}
						{expandedReplicates}
						{existingParams}
						{paramGroups}
						{siteMetadataMap}
						{matchParam}
						{newParamOption}
						{parseNewParamOption}
						{queueUpdate}
						{setEntryAction}
						{setSiteAction}
						{toggleExpand}
						{renameSiteGlobal}
						{mapSiteToExisting}
						{goToParam}
						{instrumentsFor}
						{goToInstruments}
						{replicateChip}
						{replicateRouting}
						{valuesChip}
						{streamPreview}
						onreviewsite={reviewSite}
						bind:query={tableQuery}
						bind:filter={tableFilter}
						bind:page={tablePage}
						onmarkall={markTabReviewed}
						marking={markingReviewed}
					/>

				<!-- ── PARAMETERS TAB ── -->
				{:else if activeTab === 'parameters'}
					<ParametersTab
						{reviewedKeys}
						onreview={reviewParameter}
						{instrumentsFor}
						{goToInstruments}
						bind:query={tableQuery}
						bind:filter={tableFilter}
						bind:page={tablePage}
						onmarkall={markTabReviewed}
						marking={markingReviewed}
						{unitConflicts}
						{paramGroups}
						{existingParams}
						{expandedParamGroups}
						{expandedReplicates}
						{rowWarnings}
						{mapParamToExisting}
						{renameGlobalParam}
						{splitSourceToNewParam}
						{startEditUnits}
						{commitEditUnits}
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
		blockedReason={applyBlocked}
		{familySummary}
		instruments={instrumentBindings}
		{applying}
		{applyJobId}
		onback={() => setMode('review')}
		onapply={applyPlan}
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
