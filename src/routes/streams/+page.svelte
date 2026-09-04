<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { base } from '$app/paths';
	import { beforeNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ApiError } from '$api/client';
	import { api, type DataStream, type SiteParameter, type Site, type Parameter } from '$api/crud';
	import {
		pairStream, unpairStream, getStreamStats, listStreamReceipts, retagStreams, createPairingPlan, updatePairingPlan,
		applyPairingPlan, revertPairingPlan, pollJob, getUnpairedSummary, getPlanSiteMetadata,
		replicateSpec, getPendingAuditSummary, getReconciliationCandidates, getStreamPreview, declareSdEstimator,
		getPlanInstruments, listPairingPlans, supersedePairingPlan, getPairingPlan, bulkUpdatePairingPlan,
		type PairingPlan, type PairingPlanEntry, type PlanEntryUpdate, type SdEstimator, type PairingPlanApplyResult, type StreamStats, type SiteMetadata,
		type PlanReplicateSummary, type StreamReceipt, type PlanWarning, type PlanInstrumentRef,
		type PlanInstruments, type PlanInstrumentGroup, type PlanDeviceGroup, type PlanCurveAssignment,
		type PairingPlanListing,
	type StreamPreview,
	} from '$api/service';
	import { listReplicateAudits } from '$api/service';
	import { me } from '$auth/me.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatRelativeTime, holdKindBreakdown } from '$lib/utils';
	import { createUrlTab } from '$lib/urlTab.svelte';
	import { createDraftQueue } from '$lib/pairing/draftQueue';
	import { entryStatus, matchesFilter, statusLabel, type EntryFilter } from '$lib/pairing/entryStatus';
	import PairSkipToggle from '$components/ui/PairSkipToggle.svelte';
	import MappingSelect, { type MappingGroup } from '$components/ui/MappingSelect.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import ImportSensorDialog from '$components/streams/ImportSensorDialog.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import { formatDateTime, formatSignificant } from '$lib/utils';
	import Button from '$components/ui/Button.svelte';
	import Tabs from '$components/ui/Tabs.svelte';
	import ReplicateFamilyBadge from '$components/streams/ReplicateFamilyBadge.svelte';
	import ReplicateAuditsPanel from '$components/logs/ReplicateAuditsPanel.svelte';
	import InstrumentCurvesPanel from '$components/streams/InstrumentCurvesPanel.svelte';
	import { formatCount } from '$lib/format';

	// ── Stream list state ──
	let streams = $state<DataStream[]>([]);
	let siteParams = $state<SiteParameter[]>([]);
	let sites = $state<Site[]>([]);
	let params = $state<Parameter[]>([]);
	let total = $state(0);
	let loading = $state(true);
	let listFilter = $state<'all' | 'paired' | 'unpaired'>('all');
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

	// Replicate-sync surfacing: withheld audit groups banner + reconciliation entry point
	// (shown when any source still has legacy per-avg-column streams to migrate).
	let pendingAudits = $state(0);
	// The queue carries six kinds; naming them keeps a fired brake from reading as a statistics
	// disagreement without opening the tab.
	let pendingByKind = $state<Record<string, number>>({});
	const auditBreakdown = $derived(holdKindBreakdown(pendingByKind));
	// The list mode is a two-tab hub: the streams table and the replicate-audit holds.
	// The audit surface is manager-only; below that level the page is the streams table alone.
	const canAudit = $derived(me.can('manageSensors'));
	const tab = createUrlTab({ keys: ['streams', 'audits', 'instruments'] });
	const tabLabels = $derived(
		canAudit
			? ['Streams', pendingAudits > 0 ? `Audits (${pendingAudits})` : 'Audits', 'Instruments']
			: ['Streams'],
	);
	let reconFamilyCount = $state(0);
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

	async function loadReplicateSurfacing(sources: string[]) {
		if (canAudit) {
			try {
				const summary = await getPendingAuditSummary();
				pendingAudits = summary.pending;
				pendingByKind = summary.byKind;
			} catch { /* banner is best-effort */ }
		}
		if (canAudit) {
			try {
				const results = await Promise.all(
					sources
						.filter((s) => !NON_INSTRUMENT_SOURCES.includes(s))
						.map((s) => getReconciliationCandidates(s).catch(() => null)),
				);
				reconFamilyCount = results.reduce((n, r) => n + (r?.families.length ?? 0), 0);
			} catch { /* entry point is best-effort */ }
		}
	}

	// ── Manual pair dialog ──
	let pairDialogOpen = $state(false);
	let pairStream_ = $state<DataStream | null>(null);
	let selectedSiteParam = $state('');
	let pairing = $state(false);

	// ── Import dialog (register the stream's device into inventory, no site) ──
	let importDialogOpen = $state(false);
	let importStream_ = $state<DataStream | null>(null);

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
	let reverting = $state(false);
	let saving = $state(false);

	// ── Plan review controls ──
	// The review's own position is in the URL, so a reload lands on the same tab, page and filter
	// rather than at the top of a 1891-entry plan.
	const reviewParam = (name: string) => page.url.searchParams.get(name);
	let siteSearch = $state(reviewParam('q') ?? '');
	let reviewFilter = $state<EntryFilter>((reviewParam('filter') as EntryFilter) ?? 'all');
	let expandedSites = $state<Set<string>>(new Set());
	let editingSite = $state<string | null>(null);
	let editingParam = $state<{ site: string; streamId: string } | null>(null);
	let editingGlobalParam = $state<string | null>(null);
	let editValue = $state('');
	let customParamInput = $state<string | null>(null);
	let expandedParamGroups = $state<Set<string>>(new Set());
	let splitParamInput = $state<{ groupName: string; sourceName: string } | null>(null);
	let splitParamValue = $state('');
	let sitePage = $state(Math.max(0, Number(reviewParam('page') ?? '1') - 1) || 0);
	const sitesPerPage = 50;
	// Parameters first: it is the cross-site editor, and every decision in the plan (naming, units,
	// instruments) is made once there rather than 31 times in Sites.
	let reviewTab = $state<'parameters' | 'sites' | 'instruments' | 'curves'>(
		(reviewParam('review_tab') as 'parameters' | 'sites' | 'instruments' | 'curves') ??
			'parameters',
	);
	// The plan's instrument picture, including instruments the source registered that this plan
	// binds to nothing. Refetched after every instrument edit, since an attach moves a whole scope.
	let planInstruments = $state<PlanInstruments | null>(null);
	let instrumentSaving = $state<string | null>(null);

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
			set('review_tab', tab, 'parameters');
			set('filter', filter, 'all');
			set('q', search.trim(), '');
			set('page', String(pageNo + 1), '1');
			if (url.toString() !== page.url.toString()) {
				goto(url, { replaceState: true, noScroll: true });
			}
		});
	});

	// ── Derived: group entries by site ──
	interface SiteGroup {
		siteName: string;
		project: string;
		entries: PairingPlanEntry[];
		pairCount: number;
		skipCount: number;
		warningCount: number;
	}

	const siteGroups = $derived.by((): SiteGroup[] => {
		const map = new Map<string, PairingPlanEntry[]>();
		for (const e of planEntries) {
			const key = e.site.name;
			const arr = map.get(key);
			if (arr) arr.push(e); else map.set(key, [e]);
		}
		const groups: SiteGroup[] = [];
		for (const [siteName, entries] of map) {
			groups.push({
				siteName,
				project: entries[0]?.project.name ?? '',
				entries,
				pairCount: entries.filter((e) => e.action === 'pair').length,
				skipCount: entries.filter((e) => e.action === 'skip').length,
				warningCount: entries.reduce((n, e) => n + e.warnings.length, 0),
			});
		}
		return groups.sort((a, b) => a.siteName.localeCompare(b.siteName));
	});

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

	// One curve column is one instrument across the whole source, so these are grouped by the
	// instrument's identity, never by stream: 31 DOC streams are one decision.
	interface InstrumentGroup {
		key: string;
		instrument: PlanInstrumentRef;
		streamCount: number;
		siteCount: number;
		parameters: string[];
		anchorStreamId: string;
	}

	const instrumentGroups = $derived.by((): InstrumentGroup[] => {
		const map = new Map<string, { instrument: PlanInstrumentRef; streams: Set<string>; sites: Set<string>; params: Set<string>; anchor: string }>();
		for (const e of planEntries) {
			if (e.action !== 'pair' || !e.instrument) continue;
			const key = e.instrument.curve_column ?? e.instrument.source_key ?? e.instrument.name;
			let g = map.get(key);
			if (!g) { g = { instrument: e.instrument, streams: new Set(), sites: new Set(), params: new Set(), anchor: e.stream_id }; map.set(key, g); }
			g.streams.add(e.stream_id);
			g.sites.add(e.site.name);
			g.params.add(e.parameter.name);
		}
		return [...map.entries()]
			.map(([key, g]) => ({
				key,
				instrument: g.instrument,
				streamCount: g.streams.size,
				siteCount: g.sites.size,
				parameters: [...g.params].sort(),
				anchorStreamId: g.anchor,
			}))
			.sort((a, b) => a.key.localeCompare(b.key));
	});

	const unresolvedInstruments = $derived(
		instrumentGroups.filter((g) => g.instrument.create && !g.instrument.confirmed),
	);

	// ── Instrument decisions ──
	// One list, questions first: an instrument the plan has bound and a source parameter still
	// without one are the same decision at two stages, so they are edited in one place and only
	// mirrored elsewhere. Which way the list is grouped comes from the server: a portal source
	// groups by parameter or curve column, a source that identifies its hardware by serial reports
	// devices instead, and those are not questions at all.
	interface InstrumentDecision {
		key: string;
		scope: string;
		name: string;
		proposedName: string;
		group: PlanInstrumentGroup | null;
		parameters: string[];
		siteCount: number;
		streamCount: number;
		anchorStreamId: string;
	}

	const instrumentDecisions = $derived.by((): InstrumentDecision[] => {
		const rows: InstrumentDecision[] = [];
		for (const u of planInstruments?.unassigned ?? []) {
			rows.push({
				key: u.scope,
				scope: u.scope,
				name: u.suggested_name,
				proposedName: u.suggested_name,
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
		instrumentDecisions.filter((d) => d.group === null || (d.group.create && !d.group.confirmed))
			.length,
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

	function instrumentStatus(d: InstrumentDecision): 'existing' | 'new' | 'unset' {
		if (d.group?.instrument_id) return 'existing';
		return d.group ? 'new' : 'unset';
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

	function goToInstrument(scope: string) {
		reviewTab = 'instruments';
		setTimeout(() => {
			const row = document.getElementById(`instrument-row-${scope}`);
			if (!row) return;
			row.scrollIntoView({ behavior: 'smooth', block: 'center' });
			row.classList.add('flash-highlight');
			setTimeout(() => row.classList.remove('flash-highlight'), 1600);
		}, 0);
	}

	// Replicate families among the entries that will pair: stream count and how many portal
	// readings columns collapse into them.
	const familySummary = $derived.by(() => {
		let streams = 0;
		let columns = 0;
		for (const e of planEntries) {
			if (e.action !== 'pair' || !e.replicates) continue;
			streams += 1;
			columns += e.replicates.member_columns.length;
		}
		return { streams, columns };
	});

	// ── Consolidated parameter view ──
	interface ParamGroup {
		name: string;
		label: string | null;
		originalName: string;
		originalNames: string[];
		groupKey: string | null;
		units: string;
		create: boolean;
		siteCount: number;
		streamIds: string[];
		warnings: string[];
		replicates: PlanReplicateSummary | null;
		instrument: PlanInstrumentRef | null;
		pairCount: number;
	}

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

	const paramGroups = $derived.by((): ParamGroup[] => {
		// Keyed on name AND units so same-name parameters with different units get separate rows.
		const map = new Map<string, { name: string; label: string | null; originalName: string; originalNames: Set<string>; groupKey: string | null; units: string; create: boolean; siteNames: Set<string>; streamIds: string[]; warnings: Set<string>; replicates: PlanReplicateSummary | null; instrument: PlanInstrumentRef | null }>();
		for (const e of planEntries) {
			const key = `${e.parameter.name}::${e.parameter.units}`;
			let g = map.get(key);
			if (!g) { g = { name: e.parameter.name, label: e.parameter.label ?? null, originalName: e.source_name ?? e.source_key, originalNames: new Set(), groupKey: e.parameter.group_key ?? null, units: e.parameter.units, create: e.parameter.create, siteNames: new Set(), streamIds: [], warnings: new Set(), replicates: e.replicates ?? null, instrument: e.instrument ?? null }; map.set(key, g); }
			if (!g.label && e.parameter.label) g.label = e.parameter.label;
			if (!g.replicates && e.replicates) g.replicates = e.replicates;
			if (!g.instrument && e.instrument) g.instrument = e.instrument;
			if (e.original_parameter_name) g.originalNames.add(e.original_parameter_name);
			g.siteNames.add(e.site.name);
			g.streamIds.push(e.stream_id);
			for (const w of e.warnings) g.warnings.add(w.message);
		}
		const groups: ParamGroup[] = [];
		for (const g of map.values()) {
			const pairCount = planEntries.filter((e) => g.streamIds.includes(e.stream_id) && e.action === 'pair').length;
			groups.push({ name: g.name, label: g.label, originalName: g.originalName, originalNames: [...g.originalNames], groupKey: g.groupKey, units: g.units, create: g.create, siteCount: g.siteNames.size, streamIds: g.streamIds, warnings: [...g.warnings], replicates: g.replicates, instrument: g.instrument, pairCount });
		}
		return groups.sort((a, b) => a.name.localeCompare(b.name) || a.units.localeCompare(b.units));
	});

	// The divisor question is asked by the row's own control, so its warning text is not repeated
	// as prose next to it.
	const sdWarningMessages = $derived(
		new Set(
			planEntries.flatMap((e) =>
				e.warnings.filter((w) => w.kind === 'sd_estimator_undeclared').map((w) => w.message),
			),
		),
	);
	function rowWarnings(pg: ParamGroup): string[] {
		return pg.warnings.filter((w) => !sdWarningMessages.has(w));
	}

	// One row per distinct warning, carrying the structured warning so the block can offer the
	// resolutions rather than only naming the problem. The sd-estimator kind is excluded: it is
	// asked on the parameter's own row in the Parameters tab, which is also where it is coloured.
	const uniqueWarnings = $derived.by((): Array<{ warning: PlanWarning; paramName: string; count: number; anchorStreamId: string }> => {
		const map = new Map<string, { warning: PlanWarning; paramName: string; count: number; anchorStreamId: string }>();
		for (const e of planEntries) {
			for (const w of e.warnings) {
				if (w.kind === 'sd_estimator_undeclared') continue;
				const existing = map.get(w.message);
				if (existing) existing.count++;
				else map.set(w.message, { warning: w, paramName: w.parameter ?? e.parameter.name, count: 1, anchorStreamId: e.stream_id });
			}
		}
		return [...map.values()];
	});

	// One row per parameter whose source ships its own sd column, with the declaration the whole
	// group currently carries ('' = mixed or undeclared) and the audit evidence summed over its
	// streams. Declaring here writes every entry of that parameter, so one choice settles all of
	// its stations.
	const sdDecisions = $derived.by(() => {
		const map = new Map<string, { paramName: string; entries: PairingPlanEntry[]; declared: SdEstimator | ''; holds: number; population: number }>();
		for (const e of planEntries) {
			if (!e.replicates?.portal_sd_column) continue;
			let g = map.get(e.parameter.name);
			if (!g) {
				g = { paramName: e.parameter.name, entries: [], declared: '', holds: 0, population: 0 };
				map.set(e.parameter.name, g);
			}
			g.entries.push(e);
			g.holds += e.sd_holds ?? 0;
			g.population += e.sd_population_holds ?? 0;
		}
		for (const g of map.values()) {
			const values = new Set(g.entries.map((e) => (e as { sd_estimator?: SdEstimator | null }).sd_estimator ?? ''));
			g.declared = values.size === 1 ? [...values][0] : '';
		}
		return [...map.values()].sort((a, b) => a.paramName.localeCompare(b.paramName));
	});
	// Every family that has no declaration is put to the operator, plus any the audit disputes: the
	// divisor is never inferred, so a family nothing disagrees with still has to be declared, and a
	// disagreement the population divisor explains is the evidence shown beside the choice.
	const sdDisputed = $derived(sdDecisions.filter((g) => g.holds > 0 || !g.declared));
	const sdDisputedByParam = $derived(new Map(sdDisputed.map((g) => [g.paramName, g])));
	const sdOpen = $derived(sdDisputed.filter((g) => !g.declared).length);

	function auditClassParam(v: string | null): 'population_sd' | 'not_population_sd' | undefined {
		return v === 'population_sd' || v === 'not_population_sd' ? v : undefined;
	}

	function auditViewParam(v: string | null): 'review' | 'resolved' | 'deferred' {
		return v === 'deferred' || v === 'resolved' ? v : 'review';
	}

	// The counts quoted next to a divisor decision are the audit queue's own, so they open it on
	// exactly the holds they counted. The holds are on unpaired streams until the plan applies,
	// which is the queue's `deferred` view.
	function showDivisorHolds(
		group: { paramName: string; entries: PairingPlanEntry[] },
		classification: 'population_sd' | 'not_population_sd',
	) {
		const ids = group.entries.map((e) => e.stream_id).join(',');
		void flushUpdates();
		tab.go(
			'audits',
			(url) => {
				url.searchParams.delete('step');
				url.searchParams.set('view', 'deferred');
				url.searchParams.set('holds_streams', ids);
				url.searchParams.set('holds_class', classification);
				url.searchParams.set('holds_label', group.paramName);
			},
			// Pushed, not replaced: back returns to the review, which keeps the plan it was
			// editing, rather than dropping out of the wizard entirely.
			{ push: true },
		);
	}

	function setParamEstimator(group: { entries: PairingPlanEntry[] }, value: SdEstimator | '') {
		const updates: PlanEntryUpdate[] = group.entries.map((e) => {
			(e as { sd_estimator?: SdEstimator | null }).sd_estimator = value || null;
			return { stream_id: e.stream_id, sd_estimator: value };
		});
		planEntries = [...planEntries];
		queueUpdate(updates);
	}

	// ── Instrument decisions ──
	// All three write through the same debounced PATCH the rest of the review uses; the server
	// applies them to every entry sharing the curve column, so one click settles the whole group.
	async function confirmInstrument(group: { key: string; anchorStreamId: string }) {
		instrumentSaving = group.key;
		queueUpdate([{ stream_id: group.anchorStreamId, instrument_confirmed: true }]);
		try { await flushUpdates(); } catch { /* the toast from the failed flush is the signal */ }
		finally { instrumentSaving = null; }
		await loadPlanInstruments();
	}

	async function repointInstrument(streamId: string, sensorId: string) {
		if (!sensorId) return;
		queueUpdate([{ stream_id: streamId, instrument_id: sensorId }]);
		try { await flushUpdates(); } catch { /* as above */ }
		await loadPlanInstruments();
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
	async function rehomeCurve(curve: PlanCurveAssignment, target: string) {
		if (!target || !plan) return;
		try {
			if (target.startsWith(PLAN_INSTRUMENT_PREFIX)) {
				plan = await updatePairingPlan(plan.id, plan.version, [], [{ curve_id: curve.id, instrument_source_key: target.slice(PLAN_INSTRUMENT_PREFIX.length) }]);
			} else {
				if (curve.pending_source_key) {
					plan = await updatePairingPlan(plan.id, plan.version, [], [{ curve_id: curve.id, instrument_source_key: null }]);
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

	// The suggestions as a set: one click rather than one per parameter, the same decision either
	// way since each carries its own suggested name.
	async function acceptAllSuggestions() {
		const rows = planInstruments?.unassigned ?? [];
		if (rows.length === 0) return;
		acceptingSuggestions = true;
		try {
			queueUpdate(rows.map((u) => ({
				stream_id: u.anchor_stream_id,
				instrument_name: u.suggested_name,
				instrument_confirmed: true,
			})));
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
			(e.parameter as any).units = units;
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
		setTimeout(() => {
			const row = document.getElementById(`param-row-${paramName}`);
			if (!row) return;
			row.scrollIntoView({ behavior: 'smooth', block: 'center' });
			row.classList.add('flash-highlight');
			setTimeout(() => row.classList.remove('flash-highlight'), 1600);
		}, 0);
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
				(e.parameter as any).name = newName.trim();
				(e.parameter as any).create = true;
				(e.parameter as any).id = null;
				const update: PlanEntryUpdate = { stream_id: e.stream_id, parameter_name: newName.trim() };
				if (newUnits !== undefined && newUnits !== e.parameter.units) {
					(e.parameter as any).units = newUnits;
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
				(e.parameter as any).name = newParamName.trim();
				(e.parameter as any).create = true;
				(e.parameter as any).id = null;
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
				(e.parameter as any).units = newUnits;
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
				(e.parameter as any).label = newLabel;
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

	const draftQueue = createDraftQueue<PlanEntryUpdate>({
		send: async (batch) => {
			if (!plan) return;
			const generation = editGeneration;
			saving = true;
			try {
				const updated = await updatePairingPlan(plan.id, plan.version, batch);
				if (editGeneration === generation) {
					plan = updated;
					planEntries = [...updated.entries];
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
		onRefused: (e) => toastStore.error(`Change not applied: ${e instanceof Error ? e.message : e}`),
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
	function queueUpdate(updates: PlanEntryUpdate[], opts?: { immediate?: boolean }) {
		editGeneration++;
		draftQueue.enqueue(updates, opts);
	}

	function flushUpdates(): Promise<void> {
		return draftQueue.flush();
	}

	// ── Actions ──
	// The divisor a replicate family publishes. Asked here because pairing is the first moment it
	// can be, and left unset deliberately: the audit gate asks again rather than this guessing.
	// Entries that will pair, whose source reports an sd, and which nobody has declared a divisor
	// for, since sample is the default, that is the set the audit disputes. Quoted on the apply
	// screen so leaving it unset is a stated choice rather than an oversight.
	const undeclaredEstimatorEntries = $derived(
		planEntries.filter(
			(e) =>
				e.action === 'pair' &&
				e.replicates?.portal_sd_column &&
				!(e as { sd_estimator?: SdEstimator | null }).sd_estimator,
		),
	);

	// The families behind that count, so the confirm screen names them rather than leaving the
	// operator to find them. One row per parameter, since the divisor is declared per slot and a
	// parameter is the same decision at every site it is paired at.
	const undeclaredEstimatorFamilies = $derived.by(() => {
		const byParam = new Map<string, { paramName: string; sdColumn: string; sites: number }>();
		for (const e of undeclaredEstimatorEntries) {
			const row = byParam.get(e.parameter.name) ?? {
				paramName: e.parameter.name,
				sdColumn: e.replicates?.portal_sd_column ?? '',
				sites: 0,
			};
			row.sites += 1;
			byParam.set(e.parameter.name, row);
		}
		return [...byParam.values()].sort((a, b) => a.paramName.localeCompare(b.paramName));
	});

	function setEntryEstimator(entry: PairingPlanEntry, value: SdEstimator | '') {
		(entry as { sd_estimator?: SdEstimator | null }).sd_estimator = value || null;
		planEntries = [...planEntries];
		queueUpdate([{ stream_id: entry.stream_id, sd_estimator: value }]);
	}

	function setEntryAction(entry: PairingPlanEntry, action: 'pair' | 'skip') {
		if (entry.action === action) return;
		(entry as any).action = action;
		planEntries = [...planEntries];
		queueUpdate([{ stream_id: entry.stream_id, action }], { immediate: true });
	}

	function setSiteAction(group: SiteGroup, action: 'pair' | 'skip') {
		const updates: PlanEntryUpdate[] = [];
		for (const e of group.entries) {
			if (e.action !== action) {
				(e as any).action = action;
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
				(e as any).action = action;
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
		for (const e of entries) { (e.site as any).name = newName; (e.site as any).create = true; (e.site as any).id = null; }
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
		(entry.parameter as any).name = editValue.trim();
		(entry.parameter as any).create = true;
		(entry.parameter as any).id = null;
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

	// Slot declaration from the list, next to the family it applies to. Goes through the declare
	// endpoint (never CRUD), which enqueues the tracked retag over the slot's stored samples.
	let declaringSlot = $state<string | null>(null);
	async function declareSlotEstimator(spId: string, value: SdEstimator | '') {
		declaringSlot = spId;
		try {
			const r = await declareSdEstimator(spId, value === '' ? null : value);
			const slot = siteParams.find((sp) => sp.id === spId);
			if (slot) {
				slot.sd_estimator = r.estimator;
				siteParams = [...siteParams];
			}
			toastStore.success(
				r.samples_affected > 0
					? `${r.samples_affected} stored sample${r.samples_affected === 1 ? '' : 's'} recomputing under the new divisor`
					: 'Declared; no stored samples needed recomputing',
			);
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Declaration failed');
		} finally {
			declaringSlot = null;
		}
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

	function openImportDialog(stream: DataStream) { importStream_ = stream; importDialogOpen = true; }

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

	async function enterSourceSelect() {
		setMode('source-select');
		planLoading = true;
		try {
			const [summary, drafts] = await Promise.all([
				getUnpairedSummary(),
				listPairingPlans({ status: 'draft' }).catch(() => [] as PairingPlanListing[]),
			]);
			unpairedSummary = summary;
			openDrafts = drafts;
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
	function matchParam(name: string): Parameter | undefined {
		const q = name.trim().toLowerCase();
		if (!q) return undefined;
		return existingParams.find(
			(p) =>
				p.code.toLowerCase() === q ||
				p.name.toLowerCase() === q ||
				(p.aliases ?? []).some((a) => a.toLowerCase() === q),
		);
	}

	// Deferred audit holds for the plan's source: discrepancies recorded on unpaired streams that
	// become reviewable once pairing applies. Scoped by source system (a plan covers one source).
	let planDeferredCount = $state(0);
	async function loadPlanDeferred(sourceSystem: string) {
		if (!canAudit) { planDeferredCount = 0; return; }
		try {
			planDeferredCount = (
				await listReplicateAudits({ status: 'deferred', source_system: sourceSystem, page_size: 1 })
			).total;
		} catch { planDeferredCount = 0; }
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
			params = paramResult.data;
			sites = siteResult.data;
			existingParams = params;
			existingSites = sites;
			expandedSites = new Set();
			expandedReplicates = new Set();
			// A resumed review keeps the position the URL carries; a new plan starts at the top.
			if (!resuming) {
				siteSearch = '';
				reviewFilter = 'all';
				sitePage = 0;
			}
			applyResult = null;
			void loadPlanDeferred(loaded.source_system);
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

	async function applyPlan() {
		if (!plan) return;
		try {
			await flushUpdates();
		} catch {
			toastStore.error('Unsaved edits could not be saved; the plan was not applied.');
			return;
		}
		applying = true;
		try {
			const { job_id } = await applyPairingPlan(plan.id, plan.version);
			const job = await pollJob(job_id);
			if (job.status !== 'completed') {
				throw new Error(job.error_message ?? 'Apply job did not complete');
			}
			applyResult = (job.detail?.counts ?? null) as PairingPlanApplyResult | null;
			setMode('results');
		} catch (e) { toastStore.error(e instanceof Error ? e.message : 'Failed to apply plan'); }
		finally { applying = false; }
	}

	async function revertPlan() {
		if (!plan) return;
		reverting = true;
		try {
			const { job_id } = await revertPairingPlan(plan.id);
			const job = await pollJob(job_id);
			if (job.status !== 'completed') {
				throw new Error(job.error_message ?? 'Revert job did not complete');
			}
			// The job records what it undid; "Plan reverted" is the same sentence whether it
			// unpaired forty streams or none.
			const counts = (job.detail?.counts ?? {}) as Record<string, number>;
			const undone = Object.entries(counts)
				.filter(([, n]) => typeof n === 'number' && n > 0)
				.map(([k, n]) => `${n} ${k.replace(/_/g, ' ')}`)
				.join(', ');
			toastStore.success(undone ? `Plan reverted: ${undone}` : 'Plan reverted, nothing to undo');
			plan = null; planEntries = []; applyResult = null;
			setMode('list'); load();
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

	onMount(async () => {
		// Build the source-system facet first so the initial list can default to
		// hiding non-instrument (CSV/batch + grab-sample) streams.
		try {
			sourceSummary = await getUnpairedSummary();
			selectedSources = new Set(
				sourceSummary.map((s) => s.source_system).filter((s) => !NON_INSTRUMENT_SOURCES.includes(s)),
			);
			sourcesInitialized = true;
		} catch {
			// Facet is optional; fall back to showing everything.
			sourcesInitialized = true;
		}
		await load();
		void loadReplicateSurfacing(sourceSummary.map((s) => s.source_system));
		// A reload or a bookmark on ?step=review&plan=<id> reopens that review; the draft on the
		// server is the record, so the page rebuilds from it rather than rendering nothing.
		const resumeId = page.url.searchParams.get('plan');
		if (mode === 'review' && resumeId && !plan) await resumePlan(resumeId);
		else if (mode === 'review' && !resumeId) setMode('list');
	});
</script>

{#snippet replicateChip(key: string, rep: PlanReplicateSummary, streamId: string)}
	<button
		onclick={(e) => { e.stopPropagation(); toggleReplicateExpand(key, streamId); }}
		class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-brand-accent/10 text-brand-accent border border-brand-accent/30 cursor-pointer text-[10px] font-semibold whitespace-nowrap"
		title="This stream records {rep.n} replicates per instant; expand to see how the source columns route"
	>⧉ {rep.n} replicates {expandedReplicates.has(key) ? '▾' : '▸'}</button>
{/snippet}

{#snippet replicateRouting(rep: PlanReplicateSummary, streamId: string)}
	{@const preview = previews.get(streamId)}
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
		{#if preview === 'loading'}
			<p class="text-brand-muted pt-1">Loading recent readings…</p>
		{:else if preview === 'failed'}
			<p class="text-brand-muted pt-1">Recent readings could not be loaded.</p>
		{:else if preview && preview.instants.length === 0}
			<p class="text-brand-muted pt-1">This stream holds no readings yet.</p>
		{:else if preview}
			<div class="pt-1.5">
				<div class="text-brand-muted mb-0.5">Most recent {preview.instants.length === 1 ? 'reading' : `${preview.instants.length} readings`}, as they will be stored:</div>
				<!-- Capped so a wide replicate family scrolls itself rather than squeezing the
				     row's other columns out of the table. -->
				<div class="overflow-x-auto max-w-[520px]">
					<table class="text-[11px] tabular-nums">
						<tbody>
							{#each preview.instants as inst (inst.time)}
								<tr>
									<td class="pr-3 whitespace-nowrap text-brand-muted">{formatDateTime(inst.time)}</td>
									{#each inst.replicates as r}
										<td class="pr-3 whitespace-nowrap {r.is_flagged || r.withdrawn ? 'line-through opacity-60' : ''}">
											<span class="text-brand-muted">{r.column ?? `rep ${r.replicate_index}`}</span>
											{r.value === null || r.value === undefined ? '--' : formatSignificant(r.value)}
										</td>
									{/each}
									<td class="pl-2 whitespace-nowrap text-brand-text">
										x̄ {inst.mean?.toFixed(2) ?? '--'}
										{#if inst.sd !== null}· s {inst.sd.toFixed(2)}{/if}
										· n {inst.n}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
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
				{#if reconFamilyCount > 0}
					<a
						href="{base}/streams/reconciliation"
						class="text-sm text-brand-primary no-underline hover:underline"
						title="Migrate legacy per-avg-column streams onto their replicate families"
					>Replicate reconciliation ({reconFamilyCount})</a>
				{/if}
				<Button variant="primary" onclick={enterSourceSelect} class="font-semibold">Discover & Pair</Button>
			</div>
		</div>

		<Tabs tabs={tabLabels} bind:active={tab.index} />

		{#if tab.key === 'audits' && canAudit}
		<p class="text-sm text-brand-muted">
			Review items raised by ingest: replicate statistics that disagree with what the source
			states, a braked reconciliation pass, a curated row the source changed, a stripped curve
			claim, and missing or stale tool outputs. Nothing is withheld, every reading is stored
			and served either way; each item is queued here for a decision.
		</p>
		<ReplicateAuditsPanel
			initialView={auditViewParam(page.url.searchParams.get('view'))}
			initialHoldId={page.url.searchParams.get('holds_id') ?? undefined}
			initialStreamIds={page.url.searchParams.get('holds_streams')?.split(',') ?? undefined}
			initialClassification={auditClassParam(page.url.searchParams.get('holds_class'))}
			initialFocusLabel={page.url.searchParams.get('holds_label') ?? undefined}
			onPendingChange={(n) => (pendingAudits = n)}
		/>
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
										{#if stream.site_parameter_id}
											{@const slot = siteParams.find((sp) => sp.id === stream.site_parameter_id)}
											{#if slot}
												<select
													value={slot.sd_estimator ?? ''}
													disabled={declaringSlot === slot.id}
													onchange={(e) => declareSlotEstimator(slot.id, e.currentTarget.value as SdEstimator | '')}
													aria-label="Standard deviation formula for this slot"
													title="Which divisor this parameter's replicate standard deviation uses. Changing it recomputes the stored samples."
													class="ml-1 px-1 py-0.5 rounded border text-[10px] cursor-pointer bg-brand-surface {slot.sd_estimator ? 'border-brand-divider text-brand-text' : 'border-severity-warning-border text-severity-warning-text'}"
												>
													<option value="">sd: not declared</option>
													<option value="sample">sd: sample (n-1)</option>
													<option value="population">sd: population (n)</option>
												</select>
											{/if}
										{/if}
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
									{#if stream.site_parameter_id}
										<ConfirmPopover message="Unpair this stream? Its readings lose their site and parameter, so they leave every chart, the continuous aggregates and the public API; samples left unreferenced are deleted; the sensor's open deployment at that site is closed; and open audit holds on the stream are deferred. Re-pairing restores the attribution." confirmLabel="Unpair" onconfirm={() => handleUnpair(stream.id)}>
											<Button variant="ghost" size="sm" class="text-severity-alarm">Unpair</Button>
										</ConfirmPopover>
									{:else}
										<Button variant="ghost" size="sm" onclick={() => openPairDialog(stream)} class="text-brand-primary">Pair</Button>
										<Button variant="ghost" size="sm" onclick={() => openImportDialog(stream)} class="text-brand-primary">Import</Button>
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
								<tr class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50 {draft ? '' : 'cursor-pointer'}" onclick={() => { if (!draft) createPlan(s.source_system); }}>
									<td class="px-4 py-3 font-semibold">
										{s.source_system}
										{#if draft}
											<div class="text-xs font-normal text-brand-muted pt-0.5">
												Draft started {formatRelativeTime(draft.created_at)}:
												{formatCount(draft.summary.will_pair)} to pair,
												{formatCount(draft.summary.will_skip)} to skip
											</div>
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
										{:else}
											<Button size="sm" onclick={(e) => { e.stopPropagation(); createPlan(s.source_system); }}>Discover</Button>
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
				<Button variant="ghost" size="sm" onclick={exitWizard} class="text-brand-primary">&larr; Discard</Button>
				<h2 class="text-xl font-semibold">Review Plan: {plan.source_system}</h2>
				{#if saving}<span class="text-xs text-brand-muted">Saving…</span>
				{:else if unsavedCount > 0}
					<span class="text-xs text-severity-warning" title="Decisions taken but not yet saved to the draft">
						{formatCount(unsavedCount)} unsaved
					</span>
				{/if}
			</div>
			<Button variant="primary" onclick={() => setMode('confirm')} disabled={summary.toPair === 0} class="px-4 font-semibold">
				Apply {formatCount(summary.toPair)} pairings &rarr;
			</Button>
		</div>

		{#if planDeferredCount > 0}
			<div class="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-severity-warning-soft border border-severity-warning-border text-sm text-severity-warning-text">
				<span>{planDeferredCount} sync audit discrepanc{planDeferredCount === 1 ? 'y' : 'ies'} on these streams will need review after pairing</span>
				<button
					onclick={() => {
						void flushUpdates();
						tab.go('audits', (url) => { url.searchParams.delete('step'); url.searchParams.set('view', 'deferred'); }, { push: true });
					}}
					class="font-semibold text-severity-warning-text bg-transparent border-none p-0 cursor-pointer underline-offset-2 hover:underline"
				>View audits</button>
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

		<!-- ── ISSUES ── Everything needing a decision, in view rather than behind a tab. -->
		{#if unresolvedInstruments.length > 0 || uniqueWarnings.length > 0 || sdOpen > 0}
			<div class="rounded-md border border-severity-warning-border bg-severity-warning-soft overflow-hidden">
				<div class="px-3 py-2 text-sm font-semibold text-severity-warning-text border-b border-severity-warning-border">
					{unresolvedInstruments.length > 0
						? 'Must be resolved before applying'
						: 'Worth deciding before applying'}
				</div>

				{#each unresolvedInstruments as g (g.key)}
					<div class="px-3 py-2 border-b border-severity-warning-border/50 last:border-b-0 text-sm text-severity-warning-text">
						<div>
							<span class="font-mono">{g.instrument.curve_column}</span>
							names a standard curve on every reading of
							{g.streamCount} stream{g.streamCount === 1 ? '' : 's'}
							({g.parameters.join(', ')}), but matches no instrument this source has registered.
						</div>
						<!-- The fast path only. Naming it, attaching an existing one and seeing what
						     it covers all live on the Instruments tab, so there is one editor for the
						     decision rather than two that can disagree. -->
						<div class="flex flex-wrap items-center gap-2 mt-2">
							<span class="text-xs">Proposed: <span class="font-medium">{g.instrument.name}</span></span>
							<Button
								variant="primary"
								size="sm"
								disabled={instrumentSaving === g.key}
								onclick={() => confirmInstrument(g)}
							>{instrumentSaving === g.key ? 'Creating…' : 'Create instrument'}</Button>
							<Button size="sm" onclick={() => goToInstrument(g.instrument.curve_column ? `column:${g.instrument.curve_column}` : g.key)}>
								Open in Instruments
							</Button>
						</div>
					</div>
				{/each}

				{#if sdOpen > 0}
					<div class="px-3 py-2 border-b border-severity-warning-border/50 last:border-b-0 text-sm text-severity-warning-text">
						{sdOpen} replicate parameter{sdOpen === 1 ? '' : 's'} need{sdOpen === 1 ? 's' : ''} a
						standard-deviation divisor, highlighted in
						<button
							onclick={() => { reviewTab = 'parameters'; }}
							class="bg-transparent border-none p-0 cursor-pointer font-semibold text-severity-warning-text underline-offset-2 hover:underline"
						>Parameters</button>.
					</div>
				{/if}

				{#each uniqueWarnings as w (w.warning.message)}
					<div class="px-3 py-2 border-b border-severity-warning-border/50 last:border-b-0 text-sm text-severity-warning-text">
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
			</div>
		{/if}

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
				{#each [['parameters', `Parameters (${paramGroups.length})`], ['sites', `Sites (${siteGroups.length})`], ['instruments', `Instruments (${instrumentDecisions.length + planDevices.length})`], ['curves', `Standard curves (${planInstruments?.curves.length ?? 0})`]] as [t, label]}
					<button
						onclick={() => reviewTab = t as typeof reviewTab}
						class="px-3 py-1 text-sm rounded-t cursor-pointer border-none {reviewTab === t ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted hover:text-brand-text'}"
					>{label}</button>
				{/each}
			</div>

				<!-- ── INSTRUMENTS TAB ── -->
				<!-- The one place an instrument is chosen. Parameters and Sites mirror what is
				     decided here rather than offering a second editor over the same decision. -->
				{#if reviewTab === 'instruments'}
					<details class="text-xs text-brand-muted">
						<summary class="cursor-pointer text-brand-primary">What an instrument, a serial and a curve are here</summary>
						<div class="mt-1.5 space-y-1.5 max-w-4xl">
							<p>
								Every measurement is produced by an instrument, and this is where each of this
								source's feeds gets one. A name is a label: identity is the source key, so renaming
								an instrument later breaks nothing.
							</p>
							<p>
								A device the source identifies by serial is not a decision: the serial is the
								identity. Pairing attaches the device to its feeds and opens its deployment at the
								site, one per parameter it serves.
							</p>
							<p>
								A curve is fitted on one instrument, so a reading naming a curve must name that
								instrument too. Without one, those readings are dropped at ingest rather than stored.
							</p>
						</div>
					</details>

					{#if planDevices.length > 0}
						<div class="space-y-1">
							<h3 class="text-sm font-semibold">Devices the source identifies by serial</h3>
							<div class="rounded-md border border-brand-divider bg-brand-surface overflow-x-auto">
								<table class="w-full text-sm">
									<thead><tr class="bg-brand-bg border-b border-brand-divider">
										<th class="text-left px-3 py-2 font-semibold">Site</th>
										<th class="text-left px-3 py-2 font-semibold">Device</th>
										<th class="text-left px-3 py-2 font-semibold">Channels</th>
										<th class="text-left px-3 py-2 font-semibold">In the inventory</th>
									</tr></thead>
									<tbody>
										{#each planDevices as d (`${d.site}:${d.serial}`)}
											<tr class="border-b border-brand-divider last:border-b-0">
												<td class="px-3 py-2">{d.site}</td>
												<td class="px-3 py-2">
													<span class="font-mono text-xs">{d.serial}</span>
													{#if d.model}<span class="text-brand-muted text-xs ml-1">{d.model}</span>{/if}
												</td>
												<td class="px-3 py-2 text-xs text-brand-muted">
													{d.parameters.join(', ')}
													<span class="ml-1">({d.stream_count} stream{d.stream_count === 1 ? '' : 's'})</span>
												</td>
												<td class="px-3 py-2 text-xs">
													{#if d.instrument_id}
														<a href="{base}/sensors/{d.instrument_id}" class="text-brand-primary no-underline hover:underline">{d.instrument_name ?? d.serial}</a>
													{:else}
														<span class="text-brand-muted">created when the plan is applied</span>
													{/if}
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						</div>
					{/if}

					{#if planInstruments == null}
						<p class="text-sm text-brand-muted">Loading instruments…</p>
					{:else if instrumentDecisions.length === 0}
						<p class="text-sm text-brand-muted">
							No feed in this plan needs a lab instrument chosen{planDevices.length > 0
								? ': every one of them names a device.'
								: '.'}
						</p>
					{:else}
						<div class="flex flex-wrap items-baseline gap-2">
							<h3 class="text-sm font-semibold">Lab instruments</h3>
							{#if openInstrumentQuestions > 0}
								<span class="text-xs text-severity-warning">
									{openInstrumentQuestions} still to decide
								</span>
								<Button size="sm" disabled={acceptingSuggestions} onclick={acceptAllSuggestions} class="ml-auto">
									{acceptingSuggestions ? 'Creating…' : 'Create all suggested'}
								</Button>
							{/if}
						</div>
						<div class="rounded-md border border-brand-divider bg-brand-surface overflow-x-auto">
							<table class="w-full text-sm">
								<thead><tr class="bg-brand-bg border-b border-brand-divider">
									<th class="text-left px-3 py-2 font-semibold">Instrument</th>
									<th class="text-left px-3 py-2 font-semibold w-[240px]">Map to</th>
									<th class="text-left px-3 py-2 font-semibold">Covers</th>
									<th class="text-left px-3 py-2 font-semibold">Curves</th>
									<th class="text-left px-3 py-2 font-semibold">Status</th>
								</tr></thead>
								<tbody>
									{#each instrumentDecisions as d (d.key)}
										{@const asking = d.group === null || (d.group.create && !d.group.confirmed)}
										<tr id="instrument-row-{d.scope}" class="border-b border-brand-divider last:border-b-0 align-top {asking ? 'bg-severity-warning-soft' : ''}">
											<td class="px-3 py-2">
												{@render instrumentNameField(d.scope, d.anchorStreamId, d.proposedName, d.group)}
												{#if d.group?.curve_column}
													<div class="text-[11px] text-brand-muted mt-0.5">
														<span class="font-mono">{d.group.curve_column}</span> names a curve per reading
													</div>
												{:else if d.group}
													<div class="text-[11px] text-brand-muted mt-0.5">Corrected upstream; the curve is not re-applied</div>
												{/if}
											</td>
											<td class="px-3 py-2">
												<MappingSelect
													value={instrumentValue(d)}
													groups={instrumentOptions(d)}
													noneLabel="no instrument"
													customLabel="Custom name…"
													status={instrumentStatus(d)}
													ariaLabel="Instrument for {d.parameters.join(', ')}"
													title="Attach an existing instrument, or create the one this plan proposes. Naming one always proposes it, so a choice here is reversible."
													onchange={(v) => chooseInstrument(d, v)}
												/>
											</td>
											<td class="px-3 py-2 text-xs text-brand-muted">
												{d.parameters.join(', ')}
												<div>
													{d.streamCount} stream{d.streamCount === 1 ? '' : 's'} at
													{d.siteCount} site{d.siteCount === 1 ? '' : 's'}
												</div>
											</td>
											<td class="px-3 py-2 text-xs">
												{#if d.group && d.group.curves.length > 0}
													<ul class="list-none p-0 m-0 space-y-0.5">
														{#each d.group.curves as c (c.id)}
															<li class="font-mono text-[11px]">
																{c.name ?? c.id}
																<span class="text-brand-muted">y = {formatSignificant(c.slope)}x {c.intercept < 0 ? '−' : '+'} {formatSignificant(Math.abs(c.intercept))}</span>
															</li>
														{/each}
													</ul>
												{:else if d.group?.stamps_readings}
													<span class="text-severity-warning">no curves registered</span>
												{:else}
													<span class="text-brand-muted">--</span>
												{/if}
											</td>
											<td class="px-3 py-2 text-xs">
												{#if d.group === null}
													<Badge variant="warning">not chosen</Badge>
												{:else if d.group.create && !d.group.confirmed}
													<Badge variant="warning">proposed</Badge>
												{:else if d.group.create}
													<Badge>will be created</Badge>
												{:else}
													<Badge variant="ok">existing</Badge>
												{/if}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}

				<!-- ── STANDARD CURVES TAB ── -->
				{:else if reviewTab === 'curves'}
					<details class="text-xs text-brand-muted">
						<summary class="cursor-pointer text-brand-primary">What moving a curve does</summary>
						<p class="mt-1.5 max-w-4xl">
							A curve belongs to one instrument, so moving a curve here is what puts two columns of
							one probe (acid and no-acid, say) onto the same instrument. The instrument each
							parameter uses is chosen in Parameters.
						</p>
					</details>
					{#if planInstruments == null}
						<p class="text-sm text-brand-muted">Loading curves…</p>
					{:else if planInstruments.curves.length === 0}
						<p class="text-sm text-brand-muted">This source has replicated no standard curves.</p>
					{:else}
						<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
							<table class="w-full text-sm">
								<thead><tr class="bg-brand-bg border-b border-brand-divider">
									<th class="text-left px-3 py-2 font-semibold">Curve</th>
									<th class="text-left px-3 py-2 font-semibold">Equation</th>
									<th class="text-left px-3 py-2 font-semibold">Source key</th>
									<th class="text-right px-3 py-2 font-semibold">Readings corrected</th>
									<th class="text-left px-3 py-2 font-semibold w-[260px]">Instrument</th>
								</tr></thead>
								<tbody>
									{#each planInstruments.curves as c (c.id)}
										<tr class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50">
											<td class="px-3 py-2">
												{#if editingCurve === c.id}
													<input
														type="text"
														bind:value={curveEditValue}
														onkeydown={(e) => { if (e.key === 'Enter') commitCurveName(c.id, c.name); if (e.key === 'Escape') editingCurve = null; }}
														onblur={() => commitCurveName(c.id, c.name)}
														class="px-1 py-0.5 border border-brand-primary rounded text-sm bg-brand-surface w-56"
														use:focusOnMount
													/>
												{:else}
													<button
														onclick={() => { editingCurve = c.id; curveEditValue = c.name ?? ''; }}
														class="bg-transparent border-0 border-b border-dashed border-brand-muted cursor-pointer text-brand-text hover:text-brand-primary hover:border-brand-primary text-left"
														title="Rename this standard curve"
													>{c.name ?? c.id}</button>
												{/if}
											</td>
											<td class="px-3 py-2 font-mono text-xs">
												y = {formatSignificant(c.slope)}x {c.intercept < 0 ? '−' : '+'} {formatSignificant(Math.abs(c.intercept))}
												{#if c.r_squared != null}<span class="text-brand-muted ml-1">R² {formatSignificant(c.r_squared)}</span>{/if}
											</td>
											<td class="px-3 py-2 font-mono text-xs text-brand-muted">{c.source_key ?? '--'}</td>
											<td class="px-3 py-2 text-right text-xs {c.reading_count > 0 ? 'text-brand-text' : 'text-brand-muted'}">{formatCount(c.reading_count)}</td>
											<td class="px-3 py-2">
												<select
													value={c.pending_source_key ? PLAN_INSTRUMENT_PREFIX + c.pending_source_key : c.sensor_id}
													onchange={(e) => rehomeCurve(c, (e.target as HTMLSelectElement).value)}
													class="px-2 py-1 rounded text-xs bg-brand-surface border max-w-[240px] {c.pending_source_key ? 'border-brand-primary' : 'border-brand-divider'}"
													aria-label="Instrument for {c.name ?? c.id}"
													title={c.reading_count > 0 ? `Moving this curve changes which instrument ${formatCount(c.reading_count)} corrected readings name` : 'Move this curve to another instrument'}
												>
													{#if !labInstruments.some((s) => s.id === c.sensor_id)}
														<option value={c.sensor_id}>{c.instrument_name}</option>
													{/if}
													{#each labInstruments as s}
														<option value={s.id}>{s.name ?? s.serial_number ?? s.id}</option>
													{/each}
													{#if plannedInstruments.length > 0}
														<optgroup label="Created when this plan is applied">
															{#each plannedInstruments as p (p.sourceKey)}
																<option value={PLAN_INSTRUMENT_PREFIX + p.sourceKey}>{p.name}</option>
															{/each}
														</optgroup>
													{/if}
												</select>
												{#if c.pending_source_key}
													<div class="text-[11px] text-brand-muted mt-0.5">Moves on apply</div>
												{/if}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
						<p class="text-xs text-brand-muted">
							Moving a curve to an existing instrument happens now. Moving it to an instrument this
							plan creates happens when the plan is applied, in the same step that creates it.
						</p>
					{/if}

				<!-- ── SITES TAB ── -->
				{:else if reviewTab === 'sites'}
					<input
						type="text"
						placeholder="Search sites…"
						bind:value={siteSearch}
						oninput={() => sitePage = 0}
						class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
					/>

					<div class="flex items-center justify-between gap-3">
						<div class="text-xs text-brand-muted">{filteredGroups.length} site{filteredGroups.length === 1 ? '' : 's'} ({planEntries.filter((e) => e.action === 'pair').length} streams to pair)</div>
						<div class="flex gap-1">
							{#each [['all', 'All'], ['pair', 'Will pair'], ['skip', 'Skipped'], ['unmatched', 'Unmatched'], ['warnings', 'With warnings']] as [val, label]}
								<button
									onclick={() => { reviewFilter = val as typeof reviewFilter; sitePage = 0; }}
									class="px-2 py-0.5 text-xs rounded cursor-pointer border-none {reviewFilter === val ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted hover:text-brand-text'}"
								>{label}</button>
							{/each}
						</div>
					</div>

					<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
						{#each pagedGroups as group}
							{@const allPair = group.pairCount === group.entries.length}
							{@const allSkip = group.skipCount === group.entries.length}
							{@const isExpanded = expandedSites.has(group.siteName)}
							{@const siteMatched = existingSites.find((s) => s.name.toLowerCase() === group.siteName.toLowerCase())}
							<div class="flex items-center border-b border-brand-divider hover:bg-brand-bg/50 {allSkip ? 'opacity-50' : ''}">
								<button onclick={() => toggleExpand(group.siteName)} aria-label={isExpanded ? 'Collapse site group' : 'Expand site group'} class="px-3 py-2 bg-transparent border-none cursor-pointer text-brand-muted text-xs w-6">{isExpanded ? '▼' : '▶'}</button>
								<div class="flex-1 py-2 min-w-0">
									{#if editingSite === group.siteName}
										<input type="text" bind:value={editValue} onkeydown={(e) => { if (e.key === 'Enter') commitEditSite(); if (e.key === 'Escape') editingSite = null; }} onblur={commitEditSite} class="px-1 py-0.5 border border-brand-primary rounded text-sm bg-brand-surface w-48" autofocus />
									{:else}
										<select
											value={siteMatched ? `db:${siteMatched.id}` : `new:${group.siteName}`}
											onchange={(e) => {
												const val = (e.target as HTMLSelectElement).value;
												if (val === '__custom__') { startEditSite(group.siteName); return; }
												if (val.startsWith('db:')) {
													const es = existingSites.find((s) => s.id === val.slice(3));
													if (es) mapSiteToExisting(group.siteName, es);
												} else if (val.startsWith('new:')) {
													const newName = val.slice(4);
													if (newName !== group.siteName) renameSiteGlobal(group.siteName, newName);
												}
											}}
											class="px-1 py-0.5 rounded text-sm font-semibold bg-brand-surface border border-brand-divider max-w-[220px] {siteMatched ? 'border-severity-ok' : 'border-severity-warning'}"
										>
											<option value="__custom__">Custom name…</option>
											{#if existingSites.length > 0}
												<optgroup label="Existing sites">
													{#each existingSites as es}
														<option value="db:{es.id}">{es.name}</option>
													{/each}
												</optgroup>
											{/if}
											<optgroup label="Will be created">
												{#each siteGroups.filter((g) => !existingSites.some((es) => es.name.toLowerCase() === g.siteName.toLowerCase())) as newS}
													<option value="new:{newS.siteName}">+ {newS.siteName}</option>
												{/each}
											</optgroup>
										</select>
									{/if}
									<span class="text-xs text-brand-muted ml-2">{group.entries.length} params</span>
									{#if group.warningCount > 0}
										<span
											class="text-xs text-severity-warning ml-2"
											title={group.entries.flatMap((en) => en.warnings.map((w) => w.message)).join(', ')}
										>{group.warningCount} warn</span>
									{/if}
								</div>
								<span class="text-xs text-brand-muted px-2">{group.project}</span>
								<PairSkipToggle
									value={allPair ? 'pair' : allSkip ? 'skip' : 'mixed'}
									onchange={(a) => setSiteAction(group, a)}
									title="Pair or skip every parameter at {group.siteName}"
								/>
							</div>
							{#if isExpanded}
								{@const meta = siteMetadataMap.get(group.siteName)}
								{@const siteDevices = meta?.devices ?? []}
								{#if meta && (meta.full_name || meta.catchment || meta.glacier_name || meta.latitude || meta.elevation || siteDevices.length > 0)}
									<div class="pl-10 pr-2 py-2 border-b border-brand-divider bg-brand-primary/5 text-xs flex flex-wrap gap-x-5 gap-y-1 text-brand-muted">
										{#if meta.full_name}<span><span class="font-medium text-brand-text">{meta.full_name}</span></span>{/if}
										{#if meta.catchment}<span>Catchment: {meta.catchment}</span>{/if}
										{#if meta.glacier_name}<span>Glacier: {meta.glacier_name}{meta.glacier_rgi ? ` (${meta.glacier_rgi})` : ''}</span>{/if}
										{#if meta.location_type}<span>Location: {meta.location_type}</span>{/if}
										{#if meta.latitude && meta.longitude}<span class="font-mono">{meta.latitude.toFixed(4)}, {meta.longitude.toFixed(4)}</span>{/if}
										{#if meta.altitude_m ?? meta.elevation}<span>Elevation: {meta.altitude_m ?? meta.elevation}m</span>{/if}
										{#each siteDevices as dev (dev.serial)}
											<span>
												Device: <span class="font-mono">{dev.serial}</span>{dev.model ? ` ${dev.model}` : ''}
												({dev.streams} channel{dev.streams === 1 ? '' : 's'})
											</span>
										{/each}
										{#if meta.sample_interval_sec}<span>Interval: {meta.sample_interval_sec}s</span>{/if}
									</div>
								{/if}
								{#each group.entries as entry}
								{@const entryMatched = matchParam(entry.parameter.name)}
								{@const status = entryStatus(entry)}
								{@const entryEditing = editingParam?.streamId === entry.stream_id}
								{@const entryReplicates = entry.replicates}
									<div class="flex items-center gap-2 pl-10 pr-2 py-1.5 border-b border-brand-divider bg-brand-bg/30 text-xs {entry.action === 'skip' ? 'opacity-50' : ''}">
										<div class="flex-1 min-w-0 flex items-center gap-1.5">
											{#if entryEditing}
												{#if customParamInput !== null}
													<input
														type="text"
														bind:value={customParamInput}
														placeholder="New parameter name"
														class="px-1 py-0.5 rounded text-xs bg-brand-surface border border-brand-primary max-w-[180px]"
														autofocus
														onkeydown={(e) => {
															if (e.key === 'Enter' && customParamInput?.trim()) {
																const name = customParamInput.trim();
																(entry.parameter as any).name = name;
																(entry.parameter as any).create = true;
																planEntries = [...planEntries];
																queueUpdate([{ stream_id: entry.stream_id, parameter_name: name }]);
																customParamInput = null;
																editingParam = null;
															}
															if (e.key === 'Escape') { customParamInput = null; editingParam = null; }
														}}
													/>
													<button onclick={() => { customParamInput = null; }} class="text-[10px] text-brand-muted cursor-pointer bg-transparent border-none">cancel</button>
												{:else}
													<select
														value={entryMatched ? `db:${entryMatched.id}` : newParamOption(entry.parameter.name, entry.parameter.units)}
														onchange={(e) => {
															const val = (e.target as HTMLSelectElement).value;
															if (val === 'custom') {
																customParamInput = '';
																return;
															}
															editingParam = null;
															if (val.startsWith('db:')) {
																const ep = existingParams.find((p) => p.id === val.slice(3));
																if (ep && ep.code !== entry.parameter.name) {
																	(entry.parameter as any).name = ep.code;
																	(entry.parameter as any).create = false;
																	planEntries = [...planEntries];
																	queueUpdate([{ stream_id: entry.stream_id, parameter_name: ep.code }]);
																}
															} else if (val.startsWith('new:')) {
																const { name: newName, units: newUnits } = parseNewParamOption(val);
																const unitsChanged = newUnits !== null && newUnits !== entry.parameter.units;
																if (newName !== entry.parameter.name || unitsChanged) {
																	(entry.parameter as any).name = newName;
																	(entry.parameter as any).create = true;
																	const update: PlanEntryUpdate = { stream_id: entry.stream_id, parameter_name: newName };
																	if (unitsChanged) {
																		(entry.parameter as any).units = newUnits;
																		update.parameter_units = newUnits as string;
																	}
																	planEntries = [...planEntries];
																	queueUpdate([update]);
																}
															}
														}}
														class="px-1 py-0.5 rounded text-xs bg-brand-surface border border-brand-primary max-w-[220px]"
														autofocus
													>
														<optgroup label="Existing">
															{#each existingParams as ep}
																<option value="db:{ep.id}">{ep.name} ({ep.default_units})</option>
															{/each}
														</optgroup>
														<optgroup label="New">
															{#each paramGroups.filter((p) => !matchParam(p.name)) as newP}
																<option value={newParamOption(newP.name, newP.units)}>+ {newP.name} ({newP.units})</option>
															{/each}
														</optgroup>
														<option value="custom">Custom name…</option>
													</select>
												{/if}
											{:else}
												<button
													onclick={() => { editingParam = { site: group.siteName, streamId: entry.stream_id }; }}
													class="text-left bg-transparent border-none cursor-pointer text-brand-text hover:text-brand-primary"
													title="Change mapping for this site only"
												>
													{entry.parameter.name}
													<span class="text-brand-muted">({entry.parameter.units})</span>
												</button>
												<span class="px-1 py-0 rounded text-[10px] {entryMatched ? 'bg-severity-ok-soft text-severity-ok' : 'bg-severity-warning-soft text-severity-warning'}">{entryMatched ? 'existing' : 'new'}</span>
												<button
													onclick={() => goToParam(entry.parameter.name)}
													class="bg-transparent border-none cursor-pointer text-brand-muted hover:text-brand-primary text-[10px] ml-1"
													title="Edit this parameter for all sites"
												>edit all</button>
											{/if}
											{#if entryReplicates}
												{@render replicateChip(entry.stream_id, entryReplicates, entry.stream_id)}
											{/if}
										</div>
										<!-- Only where the divisor is still in question: a family nothing disputes
										     carries the sample declaration silently. -->
										{#if entryReplicates?.portal_sd_column && sdDisputedByParam.has(entry.parameter.name)}
											{@const declared = (entry as { sd_estimator?: SdEstimator | null }).sd_estimator ?? ''}
											<select
												value={declared}
												onchange={(e) => setEntryEstimator(entry, e.currentTarget.value as SdEstimator | '')}
												aria-label="Standard deviation formula for {entry.parameter.name}"
												title="Divisor for the sd computed from this family's replicates. The source ships its own {entryReplicates.portal_sd_column}; declare the one it used, or leave it undeclared and decide from the audit queue."
												class="px-1.5 py-0.5 rounded border text-[10px] shrink-0 cursor-pointer bg-brand-surface {declared ? 'border-brand-divider text-brand-text' : 'border-severity-warning-border text-severity-warning-text'}"
											>
												<option value="">sd: not declared</option>
												<option value="sample">sd: sample (n-1)</option>
												<option value="population">sd: population (n)</option>
											</select>
										{/if}
										<span
											class="px-1.5 py-0.5 rounded text-[10px] shrink-0 {status.matched ? 'bg-severity-ok-soft text-severity-ok' : 'bg-brand-bg text-brand-muted'}"
											title={status.matched
												? 'The catalog already holds this project, site and parameter'
												: `This plan creates: ${status.creates.join(', ') || 'nothing; the entry resolves to no slot'}`}
										>{status.matched ? '✓ matched' : statusLabel(status)}</span>
										{#if status.warnings > 0}
											<span
												class="text-xs text-severity-warning shrink-0"
												title={entry.warnings.map((w) => w.message).join(', ')}
											>{status.warnings} warn ({status.warningKinds.join(', ')})</span>
										{/if}
										<PairSkipToggle
											size="sm"
											value={entry.action === 'pair' ? 'pair' : 'skip'}
											onchange={(a) => setEntryAction(entry, a)}
											title="Pair or skip this stream"
										/>
									</div>
									{#if entryReplicates && expandedReplicates.has(entry.stream_id)}
										<div class="pl-12 pr-2 py-1.5 border-b border-brand-divider bg-brand-bg/30">
											{@render replicateRouting(entryReplicates, entry.stream_id)}
										</div>
									{/if}
								{/each}
							{/if}
						{/each}
						{#if pagedGroups.length === 0}
							<div class="px-4 py-8 text-center text-brand-muted text-sm">No sites match the current filter</div>
						{/if}
					</div>

					{#if totalSitePages > 1}
						<div class="flex items-center justify-between text-xs text-brand-muted">
							<span>Page {sitePage + 1} of {totalSitePages}</span>
							<div class="flex gap-1">
								<Button size="sm" onclick={() => sitePage = Math.max(0, sitePage - 1)} disabled={sitePage === 0}>Prev</Button>
								<Button size="sm" onclick={() => sitePage = Math.min(totalSitePages - 1, sitePage + 1)} disabled={sitePage >= totalSitePages - 1}>Next</Button>
							</div>
						</div>
					{/if}

				<!-- ── PARAMETERS TAB ── -->
				{:else if reviewTab === 'parameters'}
					<div class="flex flex-wrap items-baseline gap-2">
						<p class="text-xs text-brand-muted">Map source parameters to existing DB parameters, rename, or change units. Changes apply across all {siteGroups.length} sites.</p>
						{#if openInstrumentQuestions > 0}
							<button
								onclick={() => { reviewTab = 'instruments'; }}
								class="ml-auto text-xs text-severity-warning bg-transparent border-none p-0 cursor-pointer underline-offset-2 hover:underline"
							>{openInstrumentQuestions} instrument{openInstrumentQuestions === 1 ? '' : 's'} still to decide</button>
						{/if}
					</div>
					<!-- One predicate per button, counted from the same predicate before it runs, and
					     undone by its opposite. -->
					<div class="flex flex-wrap items-center gap-2">
						{#each bulkActions as b}
							<Button
								size="sm"
								variant="secondary"
								disabled={b.count === 0 || bulkRunning !== null}
								onclick={() => runBulkAction(b)}
								title={b.title}
							>{bulkRunning === b.key ? 'Working…' : `${b.label} (${formatCount(b.count)})`}</Button>
						{/each}
					</div>
					<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
						<table class="w-full text-sm">
							<thead><tr class="bg-brand-bg border-b border-brand-divider">
								<th class="text-left px-3 py-2 font-semibold">Source name</th>
								<th class="text-left px-3 py-2 font-semibold">Parameter name</th>
								<th class="text-left px-3 py-2 font-semibold">Units</th>
								<th class="text-left px-3 py-2 font-semibold w-[240px]">Map to</th>
								<th class="text-left px-3 py-2 font-semibold w-[260px]">Instrument</th>
								<th class="text-left px-3 py-2 font-semibold">Status</th>
								<th class="text-right px-3 py-2 font-semibold">Sites</th>
								<th class="text-right px-3 py-2 font-semibold">Everywhere</th>
							</tr></thead>
							<tbody>
								{#each paramGroups as pg}
									{@const matched = matchParam(pg.name)}
									{@const sd = sdDisputedByParam.get(pg.name)}
									{@const status = groupStatus(pg)}
									<tr
										id="param-row-{pg.name}"
										class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50 transition-shadow {sd ? (sd.declared ? 'bg-severity-ok-soft' : 'bg-severity-warning-soft') : ''}"
									>
										<td class="px-3 py-2 text-xs text-brand-muted font-mono max-w-[250px]">
										{#if pg.originalNames.length > 1}
											<button
												onclick={() => {
													const s = new Set(expandedParamGroups);
													if (s.has(pg.name)) s.delete(pg.name); else s.add(pg.name);
													expandedParamGroups = s;
												}}
												class="bg-transparent border-none cursor-pointer text-brand-muted hover:text-brand-primary text-xs p-0"
												title="Expand to split individual sources"
											>
												{expandedParamGroups.has(pg.name) ? '▾' : '▸'} {pg.originalNames.length} sources
											</button>
											{#if expandedParamGroups.has(pg.name)}
												<div class="mt-1 space-y-1 pl-2 border-l-2 border-brand-divider">
													{#each pg.originalNames as src}
														<div class="flex items-center gap-1">
															<span class="font-mono text-[11px]">{src}</span>
															{#if splitParamInput?.sourceName === src && splitParamInput?.groupName === pg.name}
																<input
																	type="text"
																	bind:value={splitParamValue}
																	placeholder="New parameter name"
																	class="px-1 py-0.5 rounded text-[11px] bg-brand-surface border border-brand-primary w-28"
																	autofocus
																	onkeydown={(e) => {
																		if (e.key === 'Enter') splitSourceToNewParam(src, splitParamValue);
																		if (e.key === 'Escape') { splitParamInput = null; splitParamValue = ''; }
																	}}
																/>
																<button onclick={() => { splitParamInput = null; splitParamValue = ''; }} class="text-[10px] text-brand-muted cursor-pointer bg-transparent border-none">cancel</button>
															{:else}
																<Button
																	variant="ghost"
																	size="sm"
																	onclick={() => { splitParamInput = { groupName: pg.name, sourceName: src }; splitParamValue = src; }}
																	class="text-[10px] text-brand-primary"
																>split</Button>
															{/if}
														</div>
													{/each}
												</div>
											{:else}
												<div class="text-[10px] opacity-70 truncate">{pg.originalNames.join(', ')}</div>
											{/if}
										{:else}
											{pg.originalNames[0] ?? pg.originalName}
										{/if}
									</td>
										<td class="px-3 py-2">
											{#if matched}
												<span class="font-medium text-brand-text font-mono" title="Already exists in the database - edit via the Parameters page">{matched.code ?? matched.name}</span>
											{:else if editingGlobalParam === pg.name}
												<input type="text" bind:value={editValue} onkeydown={(e) => { if (e.key === 'Enter') commitEditGlobalParam(); if (e.key === 'Escape') editingGlobalParam = null; }} onblur={commitEditGlobalParam} class="px-1 py-0.5 border border-brand-primary rounded text-sm bg-brand-surface w-40" autofocus />
											{:else}
												<button onclick={() => startEditGlobalParam(pg.name)} class="bg-transparent border-0 border-b border-dashed border-brand-muted cursor-pointer text-brand-text hover:text-brand-primary hover:border-brand-primary text-left font-medium font-mono">{pg.name}</button>
											{/if}
											{#if matched}
												{#if pg.label}
													<div class="text-xs text-brand-muted mt-0.5">{pg.label}</div>
												{/if}
											{:else if editingLabel === pg.name}
												<input
													type="text"
													bind:value={editLabelValue}
													onkeydown={(e) => { if (e.key === 'Enter') commitEditLabel(); if (e.key === 'Escape') editingLabel = null; }}
													onblur={commitEditLabel}
													placeholder="Display label"
													class="mt-0.5 px-1 py-0.5 border border-brand-primary rounded text-xs bg-brand-surface w-40"
													use:focusOnMount
												/>
											{:else}
												<button
													onclick={() => startEditLabel(pg)}
													class="block bg-transparent border-0 border-b border-dashed border-brand-muted cursor-pointer text-xs text-brand-muted hover:text-brand-primary hover:border-brand-primary mt-0.5 text-left"
													title="Display label for the created parameter; the code stays the source column name"
												>{pg.label ?? 'Add display label'}</button>
											{/if}
											{#if pg.replicates}
												<div class="mt-1">
													{@render replicateChip(`param:${pg.name}`, pg.replicates, pg.streamIds[0])}
												</div>
												{#if expandedReplicates.has(`param:${pg.name}`)}
													<div class="mt-1 pl-2 border-l-2 border-brand-divider">
														{@render replicateRouting(pg.replicates, pg.streamIds[0])}
													</div>
												{/if}
											{/if}
											{#if sd}
												{@const unexplained = sd.holds - sd.population}
												<div class="mt-1 flex items-center gap-2 text-[11px]">
													<select
														value={sd.declared}
														onchange={(e) => setParamEstimator(sd, e.currentTarget.value as SdEstimator | '')}
														aria-label="Standard deviation divisor for {pg.name}"
														title="The divisor the sd computed from this family's replicates uses. The source ships its own; declare the one it used."
														class="px-1 py-0.5 rounded border text-[11px] cursor-pointer bg-brand-surface {sd.declared ? 'border-brand-divider text-brand-text' : 'border-severity-warning-border text-severity-warning-text'}"
													>
														<option value="">sd: not declared</option>
														<option value="sample">sd: sample (n-1)</option>
														<option value="population">sd: population (n)</option>
													</select>
													<span class="text-brand-muted">
														{#if sd.population > 0}
															<button
																onclick={() => showDivisorHolds(sd, 'population_sd')}
																class="bg-transparent border-none p-0 cursor-pointer text-brand-primary underline-offset-2 hover:underline"
																title="Open these holds in the audit queue"
															>{sd.population} incoming sd match population (n)</button>
														{/if}
														{#if unexplained > 0}
															{sd.population > 0 ? ', ' : ''}
															<button
																onclick={() => showDivisorHolds(sd, 'not_population_sd')}
																class="bg-transparent border-none p-0 cursor-pointer text-brand-primary underline-offset-2 hover:underline"
																title="Open these holds in the audit queue"
															>{unexplained} match neither</button>
														{/if}
														{#if sd.holds === 0}divisor differs between this parameter's streams{/if}
													</span>
												</div>
											{/if}
											{#if rowWarnings(pg).length > 0}
												<div class="text-xs text-severity-warning mt-0.5">{rowWarnings(pg)[0]}</div>
											{/if}
										</td>
										<td class="px-3 py-2 text-xs">
											{#if matched}
												<span class="text-brand-muted" title="Already exists in the database - edit via the Parameters page">{matched.default_units}</span>
											{:else if editingGlobalUnits?.name === pg.name && editingGlobalUnits?.units === pg.units}
												<input type="text" bind:value={editUnitsValue} onkeydown={(e) => { if (e.key === 'Enter') commitEditUnits(); if (e.key === 'Escape') editingGlobalUnits = null; }} onblur={commitEditUnits} class="px-1 py-0.5 border border-brand-primary rounded text-xs bg-brand-surface w-20" autofocus />
											{:else}
												<button onclick={() => startEditUnits(pg.name, pg.units)} class="bg-transparent border-0 border-b border-dashed border-brand-muted cursor-pointer text-brand-muted hover:text-brand-primary hover:border-brand-primary">{pg.units || '--'}</button>
											{/if}
										</td>
										<td class="px-4 py-2">
											<select
												value={matched ? `db:${matched.id}` : newParamOption(pg.name, pg.units)}
												onchange={(e) => {
													const val = (e.target as HTMLSelectElement).value;
													if (val.startsWith('db:')) {
														const ep = existingParams.find((p) => p.id === val.slice(3));
														if (ep) mapParamToExisting(pg.name, ep);
													} else if (val.startsWith('new:')) {
														const { name: newName, units: newUnits } = parseNewParamOption(val);
														if (newName !== pg.name || (newUnits !== null && newUnits !== pg.units)) {
															renameGlobalParam(pg.name, newName, newUnits ?? undefined);
														}
													}
												}}
												class="px-2 py-1 rounded text-xs bg-brand-surface w-full max-w-[220px] border border-brand-divider {matched ? 'border-severity-ok' : 'border-severity-warning'}"
											>
												<optgroup label="Existing parameters">
													{#each existingParams as ep}
														<option value="db:{ep.id}">{ep.name} ({ep.default_units})</option>
													{/each}
												</optgroup>
												<optgroup label="Will be created">
													{#each paramGroups.filter((p) => !matchParam(p.name)) as newP}
														<option value={newParamOption(newP.name, newP.units)}>+ {newP.name} ({newP.units})</option>
													{/each}
												</optgroup>
											</select>
										</td>
										<!-- A mirror of the decision, not a second editor: one instrument
										     decision covers every site a parameter arrives at, and two
										     controls over it are how they come to disagree. -->
										<td class="px-4 py-2">
											{#if instrumentByParameter.get(pg.name)}
												{@const inst = instrumentByParameter.get(pg.name)!}
												<button
													onclick={() => goToInstrument(inst.scope)}
													class="text-left bg-transparent border-0 border-b border-dashed border-brand-muted cursor-pointer hover:text-brand-primary hover:border-brand-primary {inst.group ? 'text-brand-text' : 'text-severity-warning italic'}"
													title="Choose the instrument for this parameter"
												>{inst.group?.name ?? inst.suggestion}</button>
												<div class="text-[11px] text-brand-muted mt-0.5">
													{#if !inst.group}not chosen yet
													{:else if inst.group.create}will be created
													{:else}existing instrument{/if}
												</div>
											{:else if deviceParameters.has(pg.name)}
												{@const n = deviceSiteCount(pg.name)}
												<button
													onclick={() => { reviewTab = 'instruments'; }}
													class="text-left bg-transparent border-0 border-b border-dashed border-brand-muted cursor-pointer text-brand-text hover:text-brand-primary hover:border-brand-primary"
													title="This parameter's instrument is the device at each site"
												>a device at {n} site{n === 1 ? '' : 's'}</button>
												<div class="text-[11px] text-brand-muted mt-0.5">attached from its serial</div>
											{:else}
												<span class="text-xs text-brand-muted">--</span>
											{/if}
										</td>
										<!-- Whether the parameter itself is known, and what the entries under
										     it still create. The same status the site rows carry, summed. -->
										<td class="px-4 py-2">
											<span class="text-xs px-1.5 py-0.5 rounded {matched ? 'bg-severity-ok-soft text-severity-ok' : 'bg-severity-warning-soft text-severity-warning'}">{matched ? 'existing' : 'new'}</span>
											{#if status.unmatched > 0}
												<div class="text-[11px] text-brand-muted mt-0.5" title="Entries under this parameter whose project, site or parameter this plan would create">
													{status.unmatched} of {status.total} unmatched
												</div>
											{:else}
												<div class="text-[11px] text-severity-ok mt-0.5">all {status.total} matched</div>
											{/if}
											{#if status.warnings > 0}
												<div class="text-[11px] text-severity-warning mt-0.5">{status.warnings} with warnings</div>
											{/if}
										</td>
										<td class="px-4 py-2 text-right text-brand-muted">{pg.siteCount}</td>
										<td class="px-4 py-2 text-right whitespace-nowrap">
											<div class="inline-flex justify-end w-full">
												<PairSkipToggle
													value={pg.pairCount === pg.streamIds.length
														? 'pair'
														: pg.pairCount === 0
															? 'skip'
															: 'mixed'}
													onchange={(a) => setParamGroupAction(pg, a)}
													title="Pair or skip {pg.name} at every station"
												/>
											</div>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>

				{/if}
			</div>
		</div>

<!-- ════════════════════ CONFIRM ════════════════════ -->
{:else if mode === 'confirm' && plan}
	<div class="space-y-4 max-w-xl mx-auto">
		<div class="flex items-center gap-3">
			<Button variant="ghost" size="sm" onclick={() => setMode('review')} class="text-brand-primary">&larr; Back to review</Button>
			<h2 class="text-xl font-semibold">Confirm Plan</h2>
		</div>

		{#if openInstrumentQuestions > 0}
			<div class="rounded-md border border-severity-warning-border bg-severity-warning-soft p-3 text-sm text-severity-warning-text space-y-2">
				<div class="font-semibold">
					{openInstrumentQuestions} instrument{openInstrumentQuestions === 1 ? '' : 's'} still to decide
				</div>
				<p class="text-xs opacity-90">Apply refuses a plan holding a proposal nobody agreed to.</p>
				<Button size="sm" onclick={() => { setMode('review'); reviewTab = 'instruments'; }}>
					Open Instruments
				</Button>
			</div>
		{/if}

		<div class="rounded-md border border-brand-divider bg-brand-surface p-6 space-y-4">
			<p class="text-sm">Applying this plan will:</p>
			<div class="grid grid-cols-2 gap-3 text-sm">
				<div class="p-3 bg-brand-bg rounded"><span class="text-brand-muted block text-xs">Pair streams</span><span class="text-lg font-semibold text-severity-ok">{formatCount(summary.toPair)}</span></div>
				<div class="p-3 bg-brand-bg rounded"><span class="text-brand-muted block text-xs">Skip streams</span><span class="text-lg font-semibold">{formatCount(summary.toSkip)}</span></div>
				<div class="p-3 bg-brand-bg rounded"><span class="text-brand-muted block text-xs">Create projects</span><span class="text-lg font-semibold">{summary.newProjects}</span></div>
				<div class="p-3 bg-brand-bg rounded"><span class="text-brand-muted block text-xs">Create sites</span><span class="text-lg font-semibold">{summary.newSites}</span></div>
				<div class="p-3 bg-brand-bg rounded"><span class="text-brand-muted block text-xs">Create parameters</span><span class="text-lg font-semibold">{summary.newParams}</span></div>
				<div class="p-3 bg-brand-bg rounded"><span class="text-brand-muted block text-xs">Create instruments</span><span class="text-lg font-semibold">{plan.summary.instruments_to_create}</span></div>
				{#if planDevices.length > 0}
					<div class="p-3 bg-brand-bg rounded" title="Each device is attached to its feeds and deployed at its site, one deployment per parameter it serves">
						<span class="text-brand-muted block text-xs">Attach devices</span>
						<span class="text-lg font-semibold">{planDevices.length}</span>
					</div>
				{/if}
				{#if summary.warnings > 0}
					<div class="p-3 bg-severity-warning-soft rounded"><span class="text-severity-warning block text-xs">Warnings</span><span class="text-lg font-semibold text-severity-warning">{summary.warnings}</span></div>
				{/if}
			</div>

			{#if familySummary.streams > 0}
				<p class="text-xs text-brand-muted">
					{familySummary.streams} of these streams are replicate families ({familySummary.columns}
					readings columns collapse into them). Replicates are stored per instant at indices
					0..n-1; the source's averages and standard deviations are audited, not stored.
				</p>
			{/if}
			{#if undeclaredEstimatorFamilies.length > 0}
				<div class="px-3 py-2 rounded-md bg-severity-warning-soft border border-severity-warning-border text-xs text-severity-warning-text space-y-1">
					<p>
						{undeclaredEstimatorEntries.length} replicate famil{undeclaredEstimatorEntries.length === 1 ? 'y' : 'ies'}
						will be paired undeclared: their statistics use sample (n-1) meanwhile, and every
						disagreement the population divisor (n) explains is held in the audit queue until you
						declare one.
					</p>
					<ul class="space-y-0.5">
						{#each undeclaredEstimatorFamilies.slice(0, 6) as fam (fam.paramName)}
							<li>
								<button
									onclick={() => { setMode('review'); goToParam(fam.paramName); }}
									class="bg-transparent border-none p-0 cursor-pointer font-semibold underline-offset-2 hover:underline text-severity-warning-text"
								>{fam.paramName}</button>
								<span class="text-brand-muted">
									(source ships {fam.sdColumn}, {fam.sites} site{fam.sites === 1 ? '' : 's'})
								</span>
							</li>
						{/each}
						{#if undeclaredEstimatorFamilies.length > 6}
							<li class="text-brand-muted">and {undeclaredEstimatorFamilies.length - 6} more</li>
						{/if}
					</ul>
					<p class="text-brand-muted">Set the divisor in Review now, or leave it and decide from the audit queue.</p>
				</div>
			{/if}
			<p class="text-xs text-brand-muted">Readings will be backfilled with site and parameter IDs. Continuous aggregates will refresh in the background. This operation can be reverted.</p>

			<div class="flex gap-3 pt-2">
				<Button onclick={() => setMode('review')} class="px-4 py-2">Back to Review</Button>
				<Button variant="primary" onclick={applyPlan} disabled={applying} class="px-4 py-2 font-semibold">
					{applying ? 'Applying…' : 'Apply Plan'}
				</Button>
			</div>
		</div>
	</div>

<!-- ════════════════════ RESULTS ════════════════════ -->
{:else if mode === 'results' && applyResult}
	<div class="space-y-4 max-w-xl mx-auto">
		<h2 class="text-xl font-semibold">Plan Applied</h2>

		<div class="rounded-md border border-severity-ok bg-severity-ok-soft p-6 space-y-4">
			<div class="grid grid-cols-2 gap-3 text-sm">
				<div><span class="text-brand-muted block text-xs">Projects created</span><span class="text-lg font-semibold">{applyResult.projects_created}</span></div>
				<div><span class="text-brand-muted block text-xs">Sites created</span><span class="text-lg font-semibold">{applyResult.sites_created}</span></div>
				<div><span class="text-brand-muted block text-xs">Parameters created</span><span class="text-lg font-semibold">{applyResult.parameters_created}</span></div>
				<div><span class="text-brand-muted block text-xs">Site-parameters created</span><span class="text-lg font-semibold">{applyResult.site_parameters_created}</span></div>
				<div><span class="text-brand-muted block text-xs">Instruments created</span><span class="text-lg font-semibold">{applyResult.instruments_created}</span></div>
				<div><span class="text-brand-muted block text-xs">Streams paired</span><span class="text-lg font-semibold text-severity-ok">{formatCount(applyResult.streams_paired)}</span></div>
				<div><span class="text-brand-muted block text-xs">Readings backfilled</span><span class="text-lg font-semibold">{formatCount(applyResult.readings_backfilled)}</span></div>
			</div>
		</div>

		<div class="flex gap-3">
			<Button variant="primary" onclick={exitWizard} class="px-4 py-2 font-semibold">Done</Button>
			<ConfirmPopover message="Revert this plan? All pairings will be undone. Projects, sites, and parameters created by the plan are kept." confirmLabel="Revert" onconfirm={revertPlan}>
				<button disabled={reverting} class="px-4 py-2 border border-severity-alarm text-severity-alarm rounded-md text-sm cursor-pointer bg-transparent disabled:opacity-50">
					{reverting ? 'Reverting…' : 'Revert Plan'}
				</button>
			</ConfirmPopover>
		</div>
	</div>
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

<ImportSensorDialog bind:open={importDialogOpen} stream={importStream_} onimported={load} />

<Dialog bind:open={statsDialogOpen} title="Stream Stats" maxWidth={receipts?.length ? 'sm' : 'xs'}>
	{#snippet children()}
		{#if statsStream}
			<div class="space-y-2 text-sm">
				<div><span class="text-brand-muted">Stream:</span> <span class="font-mono">{statsStream.source_key}</span></div>
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
