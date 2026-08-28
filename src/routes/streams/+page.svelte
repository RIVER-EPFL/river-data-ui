<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api, type DataStream, type SiteParameter, type Site, type Parameter } from '$api/crud';
	import {
		pairStream, unpairStream, importStream, getStreamStats, listStreamReceipts, retagStreams, createPairingPlan, updatePairingPlan,
		applyPairingPlan, revertPairingPlan, pollJob, getUnpairedSummary, getPlanSiteMetadata,
		replicateSpec, getPendingAuditCount, getReconciliationCandidates,
		type PairingPlan, type PairingPlanEntry, type PlanEntryUpdate, type PairingPlanApplyResult, type StreamStats, type SiteMetadata,
		type PlanReplicateSummary, type StreamReceipt, type PlanWarning, type PlanInstrumentRef,
	} from '$api/service';
	import { listReplicateAudits } from '$api/service';
	import { me } from '$auth/me.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatRelativeTime } from '$lib/utils';
	import { createUrlTab } from '$lib/urlTab.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import { formatDateTime } from '$lib/utils';
	import Button from '$components/ui/Button.svelte';
	import Tabs from '$components/ui/Tabs.svelte';
	import ReplicateFamilyBadge from '$components/streams/ReplicateFamilyBadge.svelte';
	import ReplicateAuditsPanel from '$components/logs/ReplicateAuditsPanel.svelte';

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
	let searchQuery = $state('');
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
	// The list mode is a two-tab hub: the streams table and the replicate-audit holds.
	// The audit surface is manager-only; below that level the page is the streams table alone.
	const canAudit = $derived(me.can('manageSensors'));
	const tab = createUrlTab({ keys: ['streams', 'audits'] });
	const tabLabels = $derived(
		canAudit
			? ['Streams', pendingAudits > 0 ? `Audits (${pendingAudits})` : 'Audits']
			: ['Streams'],
	);
	let reconFamilyCount = $state(0);
	// Expanded replicate-routing blocks in the plan review, keyed by stream id or `param:{name}`.
	let expandedReplicates = $state<Set<string>>(new Set());
	function toggleReplicateExpand(key: string) {
		const next = new Set(expandedReplicates);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		expandedReplicates = next;
	}

	async function loadReplicateSurfacing(sources: string[]) {
		if (canAudit) {
			try {
				pendingAudits = await getPendingAuditCount();
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
	let importParamId = $state('');
	let importing = $state(false);

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
	let siteSearch = $state('');
	let reviewFilter = $state<'all' | 'pair' | 'skip'>('all');
	let expandedSites = $state<Set<string>>(new Set());
	let editingSite = $state<string | null>(null);
	let editingParam = $state<{ site: string; streamId: string } | null>(null);
	let editingGlobalParam = $state<string | null>(null);
	let editValue = $state('');
	let customParamInput = $state<string | null>(null);
	let expandedParamGroups = $state<Set<string>>(new Set());
	let splitParamInput = $state<{ groupName: string; sourceName: string } | null>(null);
	let splitParamValue = $state('');
	let sitePage = $state(0);
	const sitesPerPage = 50;
	// Parameters first: it is the cross-site editor, and every decision in the plan (naming, units,
	// instruments) is made once there rather than 31 times in Sites.
	let reviewTab = $state<'parameters' | 'sites'>('parameters');
	let instrumentSaving = $state<string | null>(null);

	// ── Derived: group entries by site ──
	interface SiteGroup {
		siteName: string;
		project: string;
		entries: PairingPlanEntry[];
		pairCount: number;
		skipCount: number;
		exactCount: number;
		noneCount: number;
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
				exactCount: entries.filter((e) => e.confidence === 'exact').length,
				noneCount: entries.filter((e) => e.confidence === 'none').length,
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
		confidence: 'exact' | 'none' | 'mixed';
		siteCount: number;
		streamIds: string[];
		warnings: string[];
		replicates: PlanReplicateSummary | null;
		instrument: PlanInstrumentRef | null;
		pairCount: number;
	}

	const paramGroups = $derived.by((): ParamGroup[] => {
		// Keyed on name AND units so same-name parameters with different units get separate rows.
		const map = new Map<string, { name: string; label: string | null; originalName: string; originalNames: Set<string>; groupKey: string | null; units: string; create: boolean; confs: Set<string>; siteNames: Set<string>; streamIds: string[]; warnings: Set<string>; replicates: PlanReplicateSummary | null; instrument: PlanInstrumentRef | null }>();
		for (const e of planEntries) {
			const key = `${e.parameter.name}::${e.parameter.units}`;
			let g = map.get(key);
			if (!g) { g = { name: e.parameter.name, label: e.parameter.label ?? null, originalName: e.source_name ?? e.source_key, originalNames: new Set(), groupKey: e.parameter.group_key ?? null, units: e.parameter.units, create: e.parameter.create, confs: new Set(), siteNames: new Set(), streamIds: [], warnings: new Set(), replicates: e.replicates ?? null, instrument: e.instrument ?? null }; map.set(key, g); }
			if (!g.label && e.parameter.label) g.label = e.parameter.label;
			if (!g.replicates && e.replicates) g.replicates = e.replicates;
			if (!g.instrument && e.instrument) g.instrument = e.instrument;
			if (e.original_parameter_name) g.originalNames.add(e.original_parameter_name);
			g.confs.add(e.confidence);
			g.siteNames.add(e.site.name);
			g.streamIds.push(e.stream_id);
			for (const w of e.warnings) g.warnings.add(w.message);
		}
		const groups: ParamGroup[] = [];
		for (const g of map.values()) {
			const confidence = g.confs.size === 1 ? (g.confs.has('exact') ? 'exact' : 'none') : 'mixed';
			const pairCount = planEntries.filter((e) => g.streamIds.includes(e.stream_id) && e.action === 'pair').length;
			groups.push({ name: g.name, label: g.label, originalName: g.originalName, originalNames: [...g.originalNames], groupKey: g.groupKey, units: g.units, create: g.create, confidence, siteCount: g.siteNames.size, streamIds: g.streamIds, warnings: [...g.warnings], replicates: g.replicates, instrument: g.instrument, pairCount });
		}
		return groups.sort((a, b) => a.name.localeCompare(b.name) || a.units.localeCompare(b.units));
	});

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
	// All three write through the same debounced PATCH the rest of the review uses; the server
	// applies them to every entry sharing the curve column, so one click settles the whole group.
	function renameInstrument(streamId: string, name: string) {
		if (!name.trim()) return;
		queueUpdate([{ stream_id: streamId, instrument_name: name.trim() }]);
	}

	async function confirmInstrument(group: { key: string; anchorStreamId: string }) {
		instrumentSaving = group.key;
		queueUpdate([{ stream_id: group.anchorStreamId, instrument_confirmed: true }]);
		try { await flushUpdates(); } catch { /* the toast from the failed flush is the signal */ }
		finally { instrumentSaving = null; }
	}

	async function repointInstrument(streamId: string, sensorId: string) {
		if (!sensorId) return;
		queueUpdate([{ stream_id: streamId, instrument_id: sensorId }]);
		try { await flushUpdates(); } catch { /* as above */ }
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

	// ── PATCH debouncing ──
	// Flushes are serialized on a promise chain; a generation counter drops server snapshots
	// that would overwrite local edits made while the PATCH was in flight.
	let patchTimer: ReturnType<typeof setTimeout> | null = null;
	let pendingUpdates: PlanEntryUpdate[] = [];
	let editGeneration = 0;
	let flushChain: Promise<void> = Promise.resolve();

	function queueUpdate(updates: PlanEntryUpdate[]) {
		pendingUpdates.push(...updates);
		editGeneration++;
		if (patchTimer) clearTimeout(patchTimer);
		patchTimer = setTimeout(() => { void flushUpdates().catch(() => {}); }, 300);
	}

	function flushUpdates(): Promise<void> {
		if (patchTimer) { clearTimeout(patchTimer); patchTimer = null; }
		const pending = flushChain.then(sendBatch);
		// The stored chain absorbs the rejection so later flushes still run; callers see it.
		flushChain = pending.catch(() => {});
		return pending;
	}

	async function sendBatch() {
		if (!plan || pendingUpdates.length === 0) return;
		const batch = pendingUpdates;
		pendingUpdates = [];
		const generation = editGeneration;
		saving = true;
		try {
			const updated = await updatePairingPlan(plan.id, batch);
			if (editGeneration === generation) {
				plan = updated;
				planEntries = [...updated.entries];
			}
		} catch (e) {
			// Keep the batch queued so the next flush retries it.
			pendingUpdates = [...batch, ...pendingUpdates];
			toastStore.error(`Failed to save changes: ${e instanceof Error ? e.message : e}`);
			throw e;
		} finally { saving = false; }
	}

	// ── Actions ──
	function toggleSiteAction(group: SiteGroup) {
		const newAction = group.pairCount === group.entries.length ? 'skip' : 'pair';
		const updates: PlanEntryUpdate[] = group.entries.map((e) => ({ stream_id: e.stream_id, action: newAction }));
		for (const e of group.entries) (e as any).action = newAction;
		planEntries = [...planEntries];
		queueUpdate(updates);
	}

	function toggleEntryAction(entry: PairingPlanEntry) {
		const newAction = entry.action === 'pair' ? 'skip' : 'pair';
		setEntryAction(entry, newAction);
	}

	function setEntryAction(entry: PairingPlanEntry, action: 'pair' | 'skip') {
		if (entry.action === action) return;
		(entry as any).action = action;
		planEntries = [...planEntries];
		queueUpdate([{ stream_id: entry.stream_id, action }]);
	}

	function setSiteAction(group: SiteGroup, action: 'pair' | 'skip') {
		const updates: PlanEntryUpdate[] = [];
		for (const e of group.entries) {
			if (e.action !== action) {
				(e as any).action = action;
				updates.push({ stream_id: e.stream_id, action });
			}
		}
		if (updates.length > 0) { planEntries = [...planEntries]; queueUpdate(updates); }
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
			queueUpdate(updates);
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
		try { await pairStream(pairStream_.id, selectedSiteParam); toastStore.success('Stream paired'); pairDialogOpen = false; load(); }
		catch (e) { toastStore.error(`Pairing failed: ${e instanceof Error ? e.message : e}`); }
		finally { pairing = false; }
	}

	function openImportDialog(stream: DataStream) { importStream_ = stream; importParamId = ''; importDialogOpen = true; }

	async function handleImport() {
		if (!importStream_ || !importParamId) return;
		importing = true;
		try {
			const res = await importStream(importStream_.id, importParamId);
			toastStore.success(`Sensor imported · ${res.attributed} reading${res.attributed === 1 ? '' : 's'} attributed`);
			importDialogOpen = false;
			load();
		} catch (e) { toastStore.error(`Import failed: ${e instanceof Error ? e.message : e}`); }
		finally { importing = false; }
	}

	async function handleUnpair(streamId: string) {
		try { await unpairStream(streamId); toastStore.success('Stream unpaired'); load(); }
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
	async function enterSourceSelect() {
		setMode('source-select');
		planLoading = true;
		try { unpairedSummary = await getUnpairedSummary(); }
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

	async function createPlan(sourceSystem: string) {
		planLoading = true;
		try {
			// Always refetch the full catalogs so dropdowns and matched-badges see every entity.
			const [newPlan, paramResult, siteResult, instrumentResult] = await Promise.all([
				createPairingPlan(sourceSystem),
				api.parameters.list({ perPage: 1000 }),
				api.sites.list({ perPage: 1000 }),
				api.sensors.list({ perPage: 500, filter: { is_lab_instrument: true } }),
			]);
			labInstruments = instrumentResult.data.map((s) => ({
				id: s.id,
				name: s.name ?? null,
				serial_number: s.serial_number ?? null,
			}));
			plan = newPlan;
			planEntries = [...plan.entries];
			params = paramResult.data;
			sites = siteResult.data;
			existingParams = params;
			existingSites = sites;
			expandedSites = new Set();
			expandedReplicates = new Set();
			siteSearch = '';
			reviewFilter = 'all';
			sitePage = 0;
			applyResult = null;
			void loadPlanDeferred(sourceSystem);
			setMode('review');
			getPlanSiteMetadata(plan.id).then((meta) => {
				const map = new Map<string, SiteMetadata>();
				for (const m of meta) map.set(m.site_name, m);
				siteMetadataMap = map;
			}).catch(() => {});
		} catch (e) { toastStore.error(`Failed to create plan: ${e instanceof Error ? e.message : e}`); }
		finally { planLoading = false; }
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
			const { job_id } = await applyPairingPlan(plan.id);
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
			toastStore.success('Plan reverted');
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
	});
</script>

{#snippet replicateChip(key: string, rep: PlanReplicateSummary)}
	<button
		onclick={(e) => { e.stopPropagation(); toggleReplicateExpand(key); }}
		class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-brand-accent/10 text-brand-accent border border-brand-accent/30 cursor-pointer text-[10px] font-semibold whitespace-nowrap"
		title="This stream records {rep.n} replicates per instant; expand to see how the source columns route"
	>⧉ {rep.n} replicates {expandedReplicates.has(key) ? '▾' : '▸'}</button>
{/snippet}

{#snippet replicateRouting(rep: PlanReplicateSummary)}
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
	</div>
{/snippet}

{#snippet instrumentCell(inst: PlanInstrumentRef)}
	{@const tone = inst.create && !inst.confirmed ? 'warning' : 'ok'}
	<div class="mt-1 text-[11px] text-brand-muted">
		<span class="text-severity-{tone}">⚗</span>
		{#if inst.curve_column}
			<span class="font-mono">{inst.curve_column}</span> →
		{/if}
		<span class="text-brand-text">{inst.name}</span>
		<span class="opacity-70">
			({inst.resolved_by === 'stream' ? 'from the stream'
				: inst.resolved_by === 'curve_label' ? 'matched on the curve label'
				: inst.resolved_by === 'manual' ? 'chosen here'
				: 'to be created'})
		</span>
		<div class="pl-3">
			{#if inst.stamps_readings}
				Each reading stores the curve it was corrected with.
			{:else}
				Corrected upstream: the instrument is recorded, the curve is not re-applied.
			{/if}
		</div>
		{#each inst.curves as c}
			<div class="pl-3 font-mono">{c.name ?? c.id} · slope {c.slope} · intercept {c.intercept}</div>
		{/each}
	</div>
{/snippet}

<svelte:head><title>Streams | River Data</title></svelte:head>

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
			Replicate groups whose recomputed mean/sd disagrees with the avg/sd the source system
			stores. The
			replicates are stored and served either way; each disagreement is queued here for review.
		</p>
		<ReplicateAuditsPanel
			initialView={page.url.searchParams.get('view') === 'deferred' ? 'deferred' : 'review'}
			onPendingChange={(n) => (pendingAudits = n)}
		/>
		{:else}

		{#if pendingAudits > 0 && canAudit}
			<div class="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-severity-warning-soft border border-severity-warning-border text-sm text-severity-warning-text">
				<span>{pendingAudits} replicate group{pendingAudits === 1 ? '' : 's'} need{pendingAudits === 1 ? 's' : ''} audit review</span>
				<button
					onclick={() => tab.go('audits')}
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
									{#if stream.site_parameter_id}
										<ConfirmPopover message="Unpair this stream?" confirmLabel="Unpair" onconfirm={() => handleUnpair(stream.id)}>
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
							<tr><td colspan="6" class="px-4 py-6 text-center text-brand-muted">No streams</td></tr>
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
								<tr class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50 cursor-pointer" onclick={() => createPlan(s.source_system)}>
									<td class="px-4 py-3 font-semibold">{s.source_system}</td>
									<td class="px-4 py-3 text-right"><span class="text-severity-warning font-semibold">{s.unpaired.toLocaleString()}</span> <span class="text-brand-muted">unpaired</span></td>
									<td class="px-4 py-3 text-right text-brand-muted">{s.paired.toLocaleString()} paired</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else}
				<p class="text-severity-ok">All streams are paired.</p>
			{/if}
			{#if fullyPaired.length > 0}
				<p class="text-xs text-brand-muted">{fullyPaired.map((s) => s.source_system).join(', ')} -- fully paired ({fullyPaired.reduce((a, s) => a + s.paired, 0).toLocaleString()} streams)</p>
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
				{#if saving}<span class="text-xs text-brand-muted">Saving…</span>{/if}
			</div>
			<Button variant="primary" onclick={() => setMode('confirm')} disabled={summary.toPair === 0} class="px-4 font-semibold">
				Apply {summary.toPair.toLocaleString()} pairings &rarr;
			</Button>
		</div>

		{#if planDeferredCount > 0}
			<div class="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-severity-warning-soft border border-severity-warning-border text-sm text-severity-warning-text">
				<span>{planDeferredCount} sync audit discrepanc{planDeferredCount === 1 ? 'y' : 'ies'} on these streams will need review after pairing</span>
				<button
					onclick={() => {
						void flushUpdates();
						tab.go('audits', (url) => { url.searchParams.delete('step'); url.searchParams.set('view', 'deferred'); });
					}}
					class="font-semibold text-severity-warning-text bg-transparent border-none p-0 cursor-pointer underline-offset-2 hover:underline"
				>View audits</button>
			</div>
		{/if}

		<!-- What the apply will do, where it cannot be missed -->
		<div class="flex flex-wrap items-center gap-2 text-xs">
			<Badge variant="ok">{summary.toPair.toLocaleString()} to pair</Badge>
			{#if summary.toSkip > 0}<Badge variant="muted">{summary.toSkip.toLocaleString()} skipped</Badge>{/if}
			<span class="text-brand-muted">will create</span>
			{#if summary.newProjects > 0}<Badge>{summary.newProjects} project{summary.newProjects === 1 ? '' : 's'}</Badge>{/if}
			{#if summary.newSites > 0}<Badge>{summary.newSites} site{summary.newSites === 1 ? '' : 's'}</Badge>{/if}
			{#if summary.newParams > 0}<Badge>{summary.newParams} parameter{summary.newParams === 1 ? '' : 's'}</Badge>{/if}
			{#if plan.summary.instruments_to_create > 0}
				<Badge variant={plan.summary.instruments_unconfirmed > 0 ? 'warning' : 'default'}>
					{plan.summary.instruments_to_create} instrument{plan.summary.instruments_to_create === 1 ? '' : 's'}
				</Badge>
			{/if}
			{#if summary.newProjects + summary.newSites + summary.newParams + plan.summary.instruments_to_create === 0}
				<span class="text-brand-muted">nothing new</span>
			{/if}
		</div>

		<!-- ── ISSUES ── Everything needing a decision, in view rather than behind a tab. -->
		{#if unresolvedInstruments.length > 0 || uniqueWarnings.length > 0}
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
						<p class="text-xs mt-1 opacity-90">
							A curve is fitted on one instrument, so a reading naming a curve must name that
							instrument too. Without one, those readings are dropped at ingest rather than stored.
						</p>
						<div class="flex flex-wrap items-center gap-2 mt-2">
							<input
								type="text"
								value={g.instrument.name}
								onchange={(e) => renameInstrument(g.anchorStreamId, (e.target as HTMLInputElement).value)}
								class="px-2 py-1 rounded text-xs bg-brand-surface border border-brand-divider w-64"
								aria-label="Instrument name"
							/>
							<Button
								variant="primary"
								size="sm"
								disabled={instrumentSaving === g.key}
								onclick={() => confirmInstrument(g)}
							>{instrumentSaving === g.key ? 'Creating…' : 'Create instrument'}</Button>
							<select
								value=""
								onchange={(e) => { repointInstrument(g.anchorStreamId, (e.target as HTMLSelectElement).value); (e.target as HTMLSelectElement).value = ''; }}
								class="px-2 py-1 rounded text-xs bg-brand-surface border border-brand-divider"
								aria-label="Use an existing instrument"
							>
								<option value="">or use an existing instrument…</option>
								{#each labInstruments as s}
									<option value={s.id}>{s.name ?? s.serial_number ?? s.id}</option>
								{/each}
							</select>
						</div>
					</div>
				{/each}

				{#each uniqueWarnings as w (w.warning.message)}
					<div class="px-3 py-2 border-b border-severity-warning-border/50 last:border-b-0 text-sm text-severity-warning-text">
						<div>{w.warning.message}</div>
						{#if w.warning.existing}
							{@const ex = w.warning.existing}
							<p class="text-xs mt-1 opacity-90">
								The catalog entry is
								<a href="{base}/parameters/{ex.id}" class="font-mono underline-offset-2 hover:underline">{ex.code}</a>
								({ex.name}), used by {ex.site_parameter_count} site{ex.site_parameter_count === 1 ? '' : 's'}
								and {ex.reading_count.toLocaleString()} reading{ex.reading_count === 1 ? '' : 's'}.
								Affects {w.count.toLocaleString()} stream{w.count === 1 ? '' : 's'}.
							</p>
							<div class="flex flex-wrap items-center gap-2 mt-2">
								<Button size="sm" onclick={() => adoptCatalogUnits(w)}>Keep catalog units ({ex.units})</Button>
								<Button size="sm" onclick={() => adoptSourceUnits(w)}>Use source units ({w.warning.source_units})</Button>
								<Button variant="ghost" size="sm" onclick={() => goToParam(w.paramName)}>Open in Parameters</Button>
							</div>
						{:else}
							<p class="text-xs mt-1 opacity-90">Affects {w.count.toLocaleString()} stream{w.count === 1 ? '' : 's'}.</p>
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
				{#each [['parameters', `Parameters (${paramGroups.length})`], ['sites', `Sites (${siteGroups.length})`]] as [t, label]}
					<button
						onclick={() => reviewTab = t as typeof reviewTab}
						class="px-3 py-1 text-sm rounded-t cursor-pointer border-none {reviewTab === t ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted hover:text-brand-text'}"
					>{label}</button>
				{/each}
			</div>

				<!-- ── SITES TAB ── -->
				{#if reviewTab === 'sites'}
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
							{#each [['all', 'All'], ['pair', 'Will pair'], ['skip', 'Skipped']] as [val, label]}
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
								<span class="w-2.5 h-2.5 rounded-full mr-2 flex-shrink-0 {group.exactCount === group.entries.length ? 'bg-severity-ok' : group.noneCount === group.entries.length ? 'bg-severity-warning' : 'bg-brand-accent'}"></span>
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
								<button onclick={() => toggleSiteAction(group)} class="px-2 py-0.5 text-xs rounded cursor-pointer border-none {allPair ? 'bg-severity-ok-soft text-severity-ok' : 'bg-brand-bg text-brand-muted opacity-50'}">Pair</button>
								<button
									onclick={() => setSiteAction(group, 'skip')}
									class="px-2 py-0.5 text-xs rounded cursor-pointer border-none {allSkip ? 'bg-severity-alarm-soft text-severity-alarm' : 'bg-brand-bg text-brand-muted opacity-50'}">Skip</button>
							</div>
							{#if isExpanded}
								{@const meta = siteMetadataMap.get(group.siteName)}
								{#if meta && (meta.full_name || meta.catchment || meta.glacier_name || meta.latitude || meta.elevation || meta.device_serial)}
									<div class="pl-10 pr-2 py-2 border-b border-brand-divider bg-brand-primary/5 text-xs flex flex-wrap gap-x-5 gap-y-1 text-brand-muted">
										{#if meta.full_name}<span><span class="font-medium text-brand-text">{meta.full_name}</span></span>{/if}
										{#if meta.catchment}<span>Catchment: {meta.catchment}</span>{/if}
										{#if meta.glacier_name}<span>Glacier: {meta.glacier_name}{meta.glacier_rgi ? ` (${meta.glacier_rgi})` : ''}</span>{/if}
										{#if meta.location_type}<span>Location: {meta.location_type}</span>{/if}
										{#if meta.latitude && meta.longitude}<span class="font-mono">{meta.latitude.toFixed(4)}, {meta.longitude.toFixed(4)}</span>{/if}
										{#if meta.altitude_m ?? meta.elevation}<span>Elevation: {meta.altitude_m ?? meta.elevation}m</span>{/if}
										{#if meta.device_serial}<span>Device: {meta.device_serial}</span>{/if}
										{#if meta.sample_interval_sec}<span>Interval: {meta.sample_interval_sec}s</span>{/if}
									</div>
								{/if}
								{#each group.entries as entry}
								{@const entryMatched = matchParam(entry.parameter.name)}
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
												{@render replicateChip(entry.stream_id, entryReplicates)}
											{/if}
										</div>
										{#if entry.warnings.length > 0}
											<span
												class="text-xs text-severity-warning shrink-0"
												title={entry.warnings.map((w) => w.message).join(', ')}
											>warn</span>
										{/if}
										<button onclick={() => setEntryAction(entry, 'pair')} class="px-1.5 py-0.5 rounded cursor-pointer border-none shrink-0 {entry.action === 'pair' ? 'bg-severity-ok-soft text-severity-ok' : 'bg-brand-bg text-brand-muted opacity-50'}">Pair</button>
										<button
											onclick={() => setEntryAction(entry, 'skip')}
											class="px-1.5 py-0.5 rounded cursor-pointer border-none shrink-0 {entry.action === 'skip' ? 'bg-severity-alarm-soft text-severity-alarm' : 'bg-brand-bg text-brand-muted opacity-50'}">Skip</button>
									</div>
									{#if entryReplicates && expandedReplicates.has(entry.stream_id)}
										<div class="pl-12 pr-2 py-1.5 border-b border-brand-divider bg-brand-bg/30">
											{@render replicateRouting(entryReplicates)}
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
					<p class="text-xs text-brand-muted">Map source parameters to existing DB parameters, rename, or change units. Changes apply across all {siteGroups.length} sites.</p>
					<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
						<table class="w-full text-sm">
							<thead><tr class="bg-brand-bg border-b border-brand-divider">
								<th class="text-left px-3 py-2 font-semibold">Source name</th>
								<th class="text-left px-3 py-2 font-semibold">Parameter name</th>
								<th class="text-left px-3 py-2 font-semibold">Units</th>
								<th class="text-left px-3 py-2 font-semibold">Map to</th>
								<th class="text-left px-3 py-2 font-semibold">Status</th>
								<th class="text-right px-3 py-2 font-semibold">Sites</th>
								<th class="text-right px-3 py-2 font-semibold">Everywhere</th>
							</tr></thead>
							<tbody>
								{#each paramGroups as pg}
									{@const matched = matchParam(pg.name)}
									<tr id="param-row-{pg.name}" class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50 transition-shadow">
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
													{@render replicateChip(`param:${pg.name}`, pg.replicates)}
												</div>
												{#if expandedReplicates.has(`param:${pg.name}`)}
													<div class="mt-1 pl-2 border-l-2 border-brand-divider">
														{@render replicateRouting(pg.replicates)}
													</div>
												{/if}
											{/if}
											{#if pg.warnings.length > 0}
												<div class="text-xs text-severity-warning mt-0.5">{pg.warnings[0]}</div>
											{/if}
											{#if pg.instrument}
												{@render instrumentCell(pg.instrument)}
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
										<td class="px-4 py-2">
											<span class="text-xs px-1.5 py-0.5 rounded {matched ? 'bg-severity-ok-soft text-severity-ok' : 'bg-severity-warning-soft text-severity-warning'}">{matched ? 'existing' : 'new'}</span>
										</td>
										<td class="px-4 py-2 text-right text-brand-muted">{pg.siteCount}</td>
										<td class="px-4 py-2 text-right whitespace-nowrap">
											<button
												onclick={() => setParamGroupAction(pg, 'pair')}
												class="px-2 py-0.5 text-xs rounded cursor-pointer border-none {pg.pairCount === pg.streamIds.length ? 'bg-severity-ok-soft text-severity-ok' : 'bg-brand-bg text-brand-muted opacity-60'}"
											>Pair</button>
											<button
												onclick={() => setParamGroupAction(pg, 'skip')}
												class="px-2 py-0.5 text-xs rounded cursor-pointer border-none ml-1 {pg.pairCount === 0 ? 'bg-severity-alarm-soft text-severity-alarm' : 'bg-brand-bg text-brand-muted opacity-60'}"
											>Skip</button>
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

		<div class="rounded-md border border-brand-divider bg-brand-surface p-6 space-y-4">
			<p class="text-sm">Applying this plan will:</p>
			<div class="grid grid-cols-2 gap-3 text-sm">
				<div class="p-3 bg-brand-bg rounded"><span class="text-brand-muted block text-xs">Pair streams</span><span class="text-lg font-semibold text-severity-ok">{summary.toPair.toLocaleString()}</span></div>
				<div class="p-3 bg-brand-bg rounded"><span class="text-brand-muted block text-xs">Skip streams</span><span class="text-lg font-semibold">{summary.toSkip.toLocaleString()}</span></div>
				<div class="p-3 bg-brand-bg rounded"><span class="text-brand-muted block text-xs">Create projects</span><span class="text-lg font-semibold">{summary.newProjects}</span></div>
				<div class="p-3 bg-brand-bg rounded"><span class="text-brand-muted block text-xs">Create sites</span><span class="text-lg font-semibold">{summary.newSites}</span></div>
				<div class="p-3 bg-brand-bg rounded"><span class="text-brand-muted block text-xs">Create parameters</span><span class="text-lg font-semibold">{summary.newParams}</span></div>
				<div class="p-3 bg-brand-bg rounded"><span class="text-brand-muted block text-xs">Create instruments</span><span class="text-lg font-semibold">{plan.summary.instruments_to_create}</span></div>
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
				<div><span class="text-brand-muted block text-xs">Streams paired</span><span class="text-lg font-semibold text-severity-ok">{applyResult.streams_paired.toLocaleString()}</span></div>
				<div><span class="text-brand-muted block text-xs">Readings backfilled</span><span class="text-lg font-semibold">{applyResult.readings_backfilled.toLocaleString()}</span></div>
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
			</div>
		{/if}
	{/snippet}
	{#snippet actions()}
		<Button onclick={() => pairDialogOpen = false}>Cancel</Button>
		<Button variant="primary" onclick={handlePair} disabled={!selectedSiteParam || pairing}>{pairing ? 'Pairing…' : 'Pair'}</Button>
	{/snippet}
</Dialog>

<Dialog bind:open={importDialogOpen} title="Import Sensor" maxWidth="sm">
	{#snippet children()}
		{#if importStream_}
			<div class="space-y-3">
				<div class="text-sm"><span class="text-brand-muted">Stream:</span> <span class="font-mono">{importStream_.source_key}</span></div>
				<p class="text-xs text-brand-muted">Registers this stream's device into the sensor inventory (creates the sensor and stamps its existing readings) without assigning it to a site. No calibration is created - the readings resolve whatever curves the sensor already has. Pair the stream separately to attribute its data to a site.</p>
				<div class="flex flex-col gap-1">
					<label for="import-param" class="text-sm font-medium">Parameter</label>
					<select id="import-param" bind:value={importParamId} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
						<option value="">-- Select --</option>
						{#each params as p}<option value={p.id}>{p.name} ({p.code})</option>{/each}
					</select>
				</div>
			</div>
		{/if}
	{/snippet}
	{#snippet actions()}
		<Button onclick={() => importDialogOpen = false}>Cancel</Button>
		<Button variant="primary" onclick={handleImport} disabled={!importParamId || importing}>{importing ? 'Importing…' : 'Import'}</Button>
	{/snippet}
</Dialog>

<Dialog bind:open={statsDialogOpen} title="Stream Stats" maxWidth={receipts?.length ? 'sm' : 'xs'}>
	{#snippet children()}
		{#if statsStream}
			<div class="space-y-2 text-sm">
				<div><span class="text-brand-muted">Stream:</span> <span class="font-mono">{statsStream.source_key}</span></div>
				{#if stats}
					<div class="grid grid-cols-2 gap-2 mt-2">
						<div><span class="text-brand-muted block">Readings</span>{stats.reading_count.toLocaleString()}</div>
						<div><span class="text-brand-muted block">Latest Value</span>{stats.latest_value ?? '--'}</div>
						<div><span class="text-brand-muted block">Min Time</span><span class="text-xs">{stats.min_time ?? '--'}</span></div>
						<div><span class="text-brand-muted block">Max Time</span><span class="text-xs">{stats.max_time ?? '--'}</span></div>
						{#if stats.withdrawn_count > 0}
							<div><span class="text-brand-muted block">Withdrawn at source</span>{stats.withdrawn_count.toLocaleString()}</div>
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
