<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api, type DataStream, type SiteParameter, type Site, type Parameter } from '$api/crud';
	import {
		pairStream, unpairStream, importStream, getStreamStats, createPairingPlan, updatePairingPlan,
		applyPairingPlan, revertPairingPlan, getUnpairedSummary, getPlanSiteMetadata,
		type PairingPlan, type PairingPlanEntry, type PlanEntryUpdate, type PairingPlanApplyResult, type StreamStats, type SiteMetadata,
	} from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatRelativeTime } from '$lib/utils';
	import Dialog from '$components/ui/Dialog.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';

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

	// ── Plan wizard state (URL-driven for browser back/forward) ──
	type WizardMode = 'list' | 'source-select' | 'review' | 'confirm' | 'results';
	const mode = $derived<WizardMode>((page.url.searchParams.get('step') as WizardMode) || 'list');

	function setMode(newMode: WizardMode) {
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
	let reviewFilter = $state<'all' | 'pair' | 'skip' | 'exact' | 'none' | 'warnings'>('all');
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
	let reviewTab = $state<'sites' | 'parameters' | 'warnings'>('sites');

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
		else if (reviewFilter === 'exact') groups = groups.filter((g) => g.exactCount > 0);
		else if (reviewFilter === 'none') groups = groups.filter((g) => g.noneCount > 0);
		else if (reviewFilter === 'warnings') groups = groups.filter((g) => g.warningCount > 0);
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

	// ── Consolidated parameter view ──
	interface ParamGroup {
		name: string;
		originalName: string;
		originalNames: string[];
		groupKey: string | null;
		units: string;
		create: boolean;
		confidence: 'exact' | 'none' | 'mixed';
		siteCount: number;
		streamIds: string[];
		warnings: string[];
	}

	const paramGroups = $derived.by((): ParamGroup[] => {
		const map = new Map<string, { originalName: string; originalNames: Set<string>; groupKey: string | null; units: string; create: boolean; confs: Set<string>; siteNames: Set<string>; streamIds: string[]; warnings: Set<string> }>();
		for (const e of planEntries) {
			const key = e.parameter.name;
			let g = map.get(key);
			if (!g) { g = { originalName: e.source_name ?? e.source_key, originalNames: new Set(), groupKey: e.parameter.group_key ?? null, units: e.parameter.units, create: e.parameter.create, confs: new Set(), siteNames: new Set(), streamIds: [], warnings: new Set() }; map.set(key, g); }
			if (e.original_parameter_name) g.originalNames.add(e.original_parameter_name);
			g.confs.add(e.confidence);
			g.siteNames.add(e.site.name);
			g.streamIds.push(e.stream_id);
			for (const w of e.warnings) g.warnings.add(w);
		}
		const groups: ParamGroup[] = [];
		for (const [name, g] of map) {
			const confidence = g.confs.size === 1 ? (g.confs.has('exact') ? 'exact' : 'none') : 'mixed';
			groups.push({ name, originalName: g.originalName, originalNames: [...g.originalNames], groupKey: g.groupKey, units: g.units, create: g.create, confidence, siteCount: g.siteNames.size, streamIds: g.streamIds, warnings: [...g.warnings] });
		}
		return groups.sort((a, b) => a.name.localeCompare(b.name));
	});

	const uniqueWarnings = $derived.by((): Array<{ message: string; paramName: string; count: number }> => {
		const map = new Map<string, { paramName: string; count: number }>();
		for (const e of planEntries) {
			for (const w of e.warnings) {
				const existing = map.get(w);
				if (existing) existing.count++; else map.set(w, { paramName: e.parameter.name, count: 1 });
			}
		}
		return [...map.entries()].map(([message, v]) => ({ message, paramName: v.paramName, count: v.count }));
	});

	function jumpToParamRow(paramName: string) {
		reviewTab = 'parameters';
		setTimeout(() => {
			const row = document.getElementById(`param-row-${paramName}`);
			if (!row) return;
			row.scrollIntoView({ behavior: 'smooth', block: 'center' });
			row.classList.add('flash-highlight');
			setTimeout(() => row.classList.remove('flash-highlight'), 1600);
		}, 0);
	}

	function jumpToWarnings(messages: string[]) {
		reviewTab = 'warnings';
		const unique = [...new Set(messages)];
		setTimeout(() => {
			let firstRow: HTMLElement | null = null;
			for (const msg of unique) {
				const row = document.querySelector<HTMLElement>(
					`[data-warning="${CSS.escape(msg)}"]`
				);
				if (!row) continue;
				if (!firstRow) firstRow = row;
				row.classList.add('flash-highlight');
				setTimeout(() => row.classList.remove('flash-highlight'), 1600);
			}
			firstRow?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}, 0);
	}

	function renameGlobalParam(oldName: string, newName: string) {
		if (!newName.trim() || newName === oldName) return;
		const updates: PlanEntryUpdate[] = [];
		for (const e of planEntries) {
			if (e.parameter.name === oldName) {
				(e.parameter as any).name = newName.trim();
				(e.parameter as any).create = true;
				(e.parameter as any).id = null;
				updates.push({ stream_id: e.stream_id, parameter_name: newName.trim() });
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

	function goToParam(paramName: string) {
		reviewTab = 'parameters';
		requestAnimationFrame(() => {
			const el = document.getElementById(`param-row-${CSS.escape(paramName)}`);
			el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
			el?.classList.add('ring-2', 'ring-brand-primary');
			setTimeout(() => el?.classList.remove('ring-2', 'ring-brand-primary'), 2000);
		});
	}

	let editingGlobalUnits = $state<string | null>(null);
	let editUnitsValue = $state('');

	function startEditUnits(paramName: string, currentUnits: string) {
		editingGlobalUnits = paramName;
		editUnitsValue = currentUnits;
	}

	function commitEditUnits() {
		if (!editingGlobalUnits || !editUnitsValue.trim()) { editingGlobalUnits = null; return; }
		const oldName = editingGlobalUnits;
		const newUnits = editUnitsValue.trim();
		const updates: PlanEntryUpdate[] = [];
		for (const e of planEntries) {
			if (e.parameter.name === oldName) {
				(e.parameter as any).units = newUnits;
				updates.push({ stream_id: e.stream_id, parameter_units: newUnits });
			}
		}
		planEntries = [...planEntries];
		editingGlobalUnits = null;
		queueUpdate(updates);
	}

	// ── PATCH debouncing ──
	let patchTimer: ReturnType<typeof setTimeout> | null = null;
	let pendingUpdates: PlanEntryUpdate[] = [];

	function queueUpdate(updates: PlanEntryUpdate[]) {
		pendingUpdates.push(...updates);
		if (patchTimer) clearTimeout(patchTimer);
		patchTimer = setTimeout(flushUpdates, 300);
	}

	async function flushUpdates() {
		if (!plan || pendingUpdates.length === 0) return;
		const batch = [...pendingUpdates];
		pendingUpdates = [];
		saving = true;
		try {
			const updated = await updatePairingPlan(plan.id, batch);
			plan = updated;
			planEntries = [...updated.entries];
		} catch {
			toastStore.error('Failed to save changes');
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

	function bulkAction(action: 'pair' | 'skip', filter?: 'exact' | 'none') {
		const updates: PlanEntryUpdate[] = [];
		for (const e of planEntries) {
			if (filter === 'exact' && e.confidence !== 'exact') continue;
			if (filter === 'none' && e.confidence !== 'none') continue;
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
		try {
			const f: Record<string, unknown> = {};
			if (listFilter === 'paired') f.site_parameter_id = '__not_null__';
			if (listFilter === 'unpaired') f.site_parameter_id = '__null__';
			const [result, spResult, sResult, pResult] = await Promise.all([
				api.dataStreams.list({ page: currentPage, perPage, sort: ['source_key', 'ASC'], filter: f }),
				siteParams.length === 0 ? api.siteParameters.list({ perPage: 500 }) : Promise.resolve(null),
				sites.length === 0 ? api.sites.list({ perPage: 200 }) : Promise.resolve(null),
				params.length === 0 ? api.parameters.list({ perPage: 500 }) : Promise.resolve(null),
			]);
			streams = result.data;
			total = result.total;
			if (spResult) siteParams = spResult.data;
			if (sResult) sites = sResult.data;
			if (pResult) params = pResult.data;
		} finally { loading = false; }
	}

	function siteParamLabel(spId: string | null): string {
		if (!spId) return 'Unpaired';
		const sp = siteParams.find((s) => s.id === spId);
		if (!sp) return spId;
		const site = sites.find((s) => s.id === sp.site_id);
		const param = params.find((p) => p.id === sp.parameter_id);
		return `${site?.name ?? '?'} / ${param?.name ?? '?'}`;
	}

	function openPairDialog(stream: DataStream) { pairStream_ = stream; selectedSiteParam = ''; pairDialogOpen = true; }

	async function handlePair() {
		if (!pairStream_ || !selectedSiteParam) return;
		pairing = true;
		try { await pairStream(pairStream_.id, selectedSiteParam); toastStore.success('Stream paired'); pairDialogOpen = false; load(); }
		catch { toastStore.error('Pairing failed'); }
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
		} catch { toastStore.error('Import failed'); }
		finally { importing = false; }
	}

	async function handleUnpair(streamId: string) {
		try { await unpairStream(streamId); toastStore.success('Stream unpaired'); load(); }
		catch { toastStore.error('Unpair failed'); }
	}

	async function openStats(stream: DataStream) {
		statsStream = stream; stats = null; statsDialogOpen = true;
		try { stats = await getStreamStats(stream.id); } catch { toastStore.error('Failed to load stats'); }
	}

	// ── Wizard navigation ──
	async function enterSourceSelect() {
		setMode('source-select');
		planLoading = true;
		try { unpairedSummary = await getUnpairedSummary(); }
		catch { toastStore.error('Failed to load unpaired summary'); setMode('list'); }
		finally { planLoading = false; }
	}

	let existingParams = $state<Parameter[]>([]);
	let existingSites = $state<Site[]>([]);
	let siteMetadataMap = $state<Map<string, SiteMetadata>>(new Map());

	async function createPlan(sourceSystem: string) {
		planLoading = true;
		try {
			const [newPlan, paramResult, siteResult] = await Promise.all([
				createPairingPlan(sourceSystem),
				params.length === 0 ? api.parameters.list({ perPage: 1000 }) : Promise.resolve(null),
				sites.length === 0 ? api.sites.list({ perPage: 1000 }) : Promise.resolve(null),
			]);
			plan = newPlan;
			planEntries = [...plan.entries];
			if (paramResult) params = paramResult.data;
			if (siteResult) sites = siteResult.data;
			existingParams = params;
			existingSites = sites;
			expandedSites = new Set();
			siteSearch = '';
			reviewFilter = 'all';
			sitePage = 0;
			applyResult = null;
			setMode('review');
			getPlanSiteMetadata(plan.id).then((meta) => {
				const map = new Map<string, SiteMetadata>();
				for (const m of meta) map.set(m.site_name, m);
				siteMetadataMap = map;
			}).catch(() => {});
		} catch { toastStore.error('Failed to create plan'); }
		finally { planLoading = false; }
	}

	async function applyPlan() {
		if (!plan) return;
		if (patchTimer) { clearTimeout(patchTimer); await flushUpdates(); }
		applying = true;
		try {
			applyResult = await applyPairingPlan(plan.id);
			setMode('results');
		} catch { toastStore.error('Failed to apply plan'); }
		finally { applying = false; }
	}

	async function revertPlan() {
		if (!plan) return;
		reverting = true;
		try {
			await revertPairingPlan(plan.id);
			toastStore.success('Plan reverted');
			plan = null; planEntries = []; applyResult = null;
			setMode('list'); load();
		} catch { toastStore.error('Failed to revert plan'); }
		finally { reverting = false; }
	}

	function exitWizard() {
		plan = null; planEntries = []; applyResult = null;
		setMode('list'); load();
	}

	onMount(load);
</script>

<svelte:head><title>Streams | River Data</title></svelte:head>

<!-- ════════════════════ STREAM LIST MODE ════════════════════ -->
{#if mode === 'list'}
	<div class="space-y-4">
		<div class="flex items-center justify-between">
			<h2 class="text-xl font-semibold">Data Streams</h2>
			<button onclick={enterSourceSelect} class="px-3 py-1.5 bg-brand-primary text-white rounded-md text-sm font-semibold cursor-pointer border-none">Discover & Pair</button>
		</div>

		<div class="flex gap-1">
			{#each ['all', 'paired', 'unpaired'] as f}
				<button
					onclick={() => { listFilter = f as typeof listFilter; currentPage = 1; load(); }}
					class="px-3 py-1 text-sm rounded-md cursor-pointer border-none {listFilter === f ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted hover:text-brand-text'}"
				>{f === 'all' ? 'All' : f === 'paired' ? 'Paired' : 'Unpaired'}</button>
			{/each}
		</div>

		<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
			<table class="w-full text-sm">
				<thead><tr class="bg-brand-bg border-b border-brand-divider">
					<th class="text-left px-4 py-2 font-semibold">Source Key</th>
					<th class="text-left px-4 py-2 font-semibold">Source Name</th>
					<th class="text-left px-4 py-2 font-semibold">System</th>
					<th class="text-left px-4 py-2 font-semibold">Paired To</th>
					<th class="text-left px-4 py-2 font-semibold">Last Data</th>
					<th class="text-left px-4 py-2 font-semibold">Actions</th>
				</tr></thead>
				<tbody>
					{#if loading}
						<tr><td colspan="6" class="px-4 py-8 text-center text-brand-muted">Loading...</td></tr>
					{:else}
						{#each streams as stream}
							<tr class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50">
								<td class="px-4 py-2 font-mono text-xs">{stream.source_key}</td>
								<td class="px-4 py-2 text-xs">{stream.source_name ?? '--'}</td>
								<td class="px-4 py-2 text-xs text-brand-muted">{stream.source_system}</td>
								<td class="px-4 py-2 text-xs {stream.site_parameter_id ? 'text-severity-ok' : 'text-brand-muted'}">{siteParamLabel(stream.site_parameter_id)}</td>
								<td class="px-4 py-2 text-xs text-brand-muted">{stream.last_data_time ? formatRelativeTime(stream.last_data_time) : '--'}</td>
								<td class="px-4 py-2 flex gap-2">
									<button onclick={() => openStats(stream)} class="text-xs text-brand-primary bg-transparent border-none cursor-pointer hover:underline">Stats</button>
									{#if stream.site_parameter_id}
										<ConfirmPopover message="Unpair this stream?" confirmLabel="Unpair" onconfirm={() => handleUnpair(stream.id)}>
											<button class="text-xs text-severity-alarm bg-transparent border-none cursor-pointer hover:underline">Unpair</button>
										</ConfirmPopover>
									{:else}
										<button onclick={() => openPairDialog(stream)} class="text-xs text-brand-primary bg-transparent border-none cursor-pointer hover:underline">Pair</button>
										<button onclick={() => openImportDialog(stream)} class="text-xs text-brand-primary bg-transparent border-none cursor-pointer hover:underline">Import</button>
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
					<button onclick={() => { currentPage = Math.max(1, currentPage - 1); load(); }} disabled={currentPage <= 1} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface disabled:opacity-40 cursor-pointer disabled:cursor-default">Prev</button>
					<span>{currentPage} / {totalPages}</span>
					<button onclick={() => { currentPage = Math.min(totalPages, currentPage + 1); load(); }} disabled={currentPage >= totalPages} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface disabled:opacity-40 cursor-pointer disabled:cursor-default">Next</button>
				</div>
			</div>
		{/if}
	</div>

<!-- ════════════════════ SOURCE SELECT ════════════════════ -->
{:else if mode === 'source-select'}
	<div class="space-y-4">
		<div class="flex items-center gap-3">
			<button onclick={() => setMode('list')} class="text-sm text-brand-primary bg-transparent border-none cursor-pointer hover:underline">&larr; Back to streams</button>
			<h2 class="text-xl font-semibold">Discover & Pair Streams</h2>
		</div>

		{#if planLoading}
			<p class="text-brand-muted">Loading sources...</p>
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
				<button onclick={exitWizard} class="text-sm text-brand-primary bg-transparent border-none cursor-pointer hover:underline">&larr; Discard</button>
				<h2 class="text-xl font-semibold">Review Plan: {plan.source_system}</h2>
				{#if saving}<span class="text-xs text-brand-muted">Saving...</span>{/if}
			</div>
			<button onclick={() => setMode('confirm')} disabled={summary.toPair === 0} class="px-4 py-1.5 bg-brand-primary text-white rounded-md text-sm font-semibold cursor-pointer border-none disabled:opacity-50">
				Apply {summary.toPair.toLocaleString()} pairings &rarr;
			</button>
		</div>

		<div class="grid grid-cols-[260px_1fr] gap-4">
			<!-- Sidebar -->
			<div class="space-y-4">
				<!-- Summary -->
				<div class="rounded-md border border-brand-divider bg-brand-surface p-3 space-y-2 text-sm">
					<div class="flex justify-between"><span class="text-brand-muted">To pair</span><span class="font-semibold text-severity-ok">{summary.toPair.toLocaleString()}</span></div>
					<div class="flex justify-between"><span class="text-brand-muted">Skipped</span><span class="font-semibold">{summary.toSkip.toLocaleString()}</span></div>
					<div class="flex justify-between"><span class="text-brand-muted">Total streams</span><span>{summary.total.toLocaleString()}</span></div>
					<hr class="border-brand-divider" />
					<div class="text-xs text-brand-muted font-semibold uppercase tracking-wider">Will create</div>
					<div class="flex justify-between text-xs"><span class="text-brand-muted">Projects</span><span>{summary.newProjects}</span></div>
					<div class="flex justify-between text-xs"><span class="text-brand-muted">Sites</span><span>{summary.newSites}</span></div>
					<div class="flex justify-between text-xs"><span class="text-brand-muted">Parameters</span><span>{summary.newParams}</span></div>
					{#if summary.warnings > 0}
						<hr class="border-brand-divider" />
						<button onclick={() => reviewFilter = 'warnings'} class="text-xs text-severity-warning bg-transparent border-none cursor-pointer hover:underline">{summary.warnings} warning{summary.warnings === 1 ? '' : 's'}</button>
					{/if}
				</div>

				<!-- Bulk actions -->
				<div class="rounded-md border border-brand-divider bg-brand-surface p-3 space-y-1.5">
					<div class="text-xs text-brand-muted font-semibold uppercase tracking-wider mb-1">Bulk actions</div>
					<button onclick={() => bulkAction('pair')} class="w-full text-left text-xs px-2 py-1 rounded bg-transparent border-none cursor-pointer hover:bg-brand-bg text-brand-text">Accept all</button>
					<button onclick={() => bulkAction('skip')} class="w-full text-left text-xs px-2 py-1 rounded bg-transparent border-none cursor-pointer hover:bg-brand-bg text-brand-text">Skip all</button>
					<button onclick={() => bulkAction('pair', 'exact')} class="w-full text-left text-xs px-2 py-1 rounded bg-transparent border-none cursor-pointer hover:bg-brand-bg text-brand-text">Accept exact matches</button>
					<button onclick={() => bulkAction('skip', 'none')} class="w-full text-left text-xs px-2 py-1 rounded bg-transparent border-none cursor-pointer hover:bg-brand-bg text-brand-text">Skip unmatched</button>
				</div>

				<!-- Filters -->
				<div class="space-y-1">
					<div class="text-xs text-brand-muted font-semibold uppercase tracking-wider">Filter</div>
					{#each [['all', 'All'], ['pair', 'Will pair'], ['skip', 'Skipped'], ['exact', 'Exact match'], ['none', 'Needs review'], ['warnings', 'Warnings']] as [val, label]}
						<button
							onclick={() => { reviewFilter = val as typeof reviewFilter; sitePage = 0; }}
							class="block w-full text-left text-xs px-2 py-1 rounded cursor-pointer border-none {reviewFilter === val ? 'bg-brand-primary text-white' : 'bg-transparent text-brand-muted hover:text-brand-text hover:bg-brand-bg'}"
						>{label} {val === 'all' ? `(${siteGroups.length})` : ''}</button>
					{/each}
				</div>
			</div>

			<!-- Main area -->
			<div class="space-y-3">
				<!-- View tabs -->
				<div class="flex gap-1 border-b border-brand-divider pb-2">
					{#each [['sites', `Sites (${siteGroups.length})`], ['parameters', `Parameters (${paramGroups.length})`], ['warnings', `Warnings (${uniqueWarnings.length})`]] as [tab, label]}
						<button
							onclick={() => reviewTab = tab as typeof reviewTab}
							class="px-3 py-1 text-sm rounded-t cursor-pointer border-none {reviewTab === tab ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted hover:text-brand-text'}"
						>{label}</button>
					{/each}
				</div>

				<!-- ── SITES TAB ── -->
				{#if reviewTab === 'sites'}
					<input
						type="text"
						placeholder="Search sites..."
						bind:value={siteSearch}
						oninput={() => sitePage = 0}
						class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
					/>

					<div class="text-xs text-brand-muted">{filteredGroups.length} site{filteredGroups.length === 1 ? '' : 's'} ({planEntries.filter((e) => e.action === 'pair').length} streams to pair)</div>

					<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
						{#each pagedGroups as group}
							{@const allPair = group.pairCount === group.entries.length}
							{@const allSkip = group.skipCount === group.entries.length}
							{@const isExpanded = expandedSites.has(group.siteName)}
							{@const siteMatched = existingSites.find((s) => s.name.toLowerCase() === group.siteName.toLowerCase())}
							<div class="flex items-center border-b border-brand-divider hover:bg-brand-bg/50 {allSkip ? 'opacity-50' : ''}">
								<button onclick={() => toggleExpand(group.siteName)} class="px-3 py-2 bg-transparent border-none cursor-pointer text-brand-muted text-xs w-6">{isExpanded ? '▼' : '▶'}</button>
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
											<option value="__custom__">Custom name...</option>
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
										<button
											type="button"
											onclick={(e) => { e.stopPropagation(); jumpToWarnings(group.entries.flatMap((en) => en.warnings)); }}
											class="text-xs text-severity-warning ml-2 bg-transparent border-none cursor-pointer hover:underline p-0"
											title="View affected warnings"
										>{group.warningCount} warn</button>
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
								{@const entryMatched = existingParams.find((p) => p.code === entry.parameter.name)}
								{@const entryEditing = editingParam?.streamId === entry.stream_id}
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
														value={entryMatched ? `db:${entryMatched.id}` : `new:${entry.parameter.name}`}
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
																const newName = val.slice(4);
																if (newName !== entry.parameter.name) {
																	(entry.parameter as any).name = newName;
																	(entry.parameter as any).create = true;
																	planEntries = [...planEntries];
																	queueUpdate([{ stream_id: entry.stream_id, parameter_name: newName }]);
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
															{#each paramGroups.filter((p) => !existingParams.some((ep) => ep.code === p.name)) as newP}
																<option value="new:{newP.name}">+ {newP.name} ({newP.units})</option>
															{/each}
														</optgroup>
														<option value="custom">Custom name...</option>
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
										</div>
										{#if entry.warnings.length > 0}
											<button
												type="button"
												onclick={(e) => { e.stopPropagation(); jumpToWarnings(entry.warnings); }}
												class="text-severity-warning shrink-0 bg-transparent border-none cursor-pointer hover:underline p-0"
												title={entry.warnings.join(', ')}
											>warn</button>
										{/if}
										<button onclick={() => setEntryAction(entry, 'pair')} class="px-1.5 py-0.5 rounded cursor-pointer border-none shrink-0 {entry.action === 'pair' ? 'bg-severity-ok-soft text-severity-ok' : 'bg-brand-bg text-brand-muted opacity-50'}">Pair</button>
										<button
											onclick={() => setEntryAction(entry, 'skip')}
											class="px-1.5 py-0.5 rounded cursor-pointer border-none shrink-0 {entry.action === 'skip' ? 'bg-severity-alarm-soft text-severity-alarm' : 'bg-brand-bg text-brand-muted opacity-50'}">Skip</button>
									</div>
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
								<button onclick={() => sitePage = Math.max(0, sitePage - 1)} disabled={sitePage === 0} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface disabled:opacity-40 cursor-pointer disabled:cursor-default">Prev</button>
								<button onclick={() => sitePage = Math.min(totalSitePages - 1, sitePage + 1)} disabled={sitePage >= totalSitePages - 1} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface disabled:opacity-40 cursor-pointer disabled:cursor-default">Next</button>
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
							</tr></thead>
							<tbody>
								{#each paramGroups as pg}
									{@const matched = existingParams.find((p) => p.code === pg.name)}
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
																<button
																	onclick={() => { splitParamInput = { groupName: pg.name, sourceName: src }; splitParamValue = src; }}
																	class="text-[10px] text-brand-primary cursor-pointer bg-transparent border-none hover:underline"
																>split</button>
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
												<span class="font-medium text-brand-text" title="Already exists in the database — edit via the Parameters page">{matched.name}</span>
											{:else if editingGlobalParam === pg.name}
												<input type="text" bind:value={editValue} onkeydown={(e) => { if (e.key === 'Enter') commitEditGlobalParam(); if (e.key === 'Escape') editingGlobalParam = null; }} onblur={commitEditGlobalParam} class="px-1 py-0.5 border border-brand-primary rounded text-sm bg-brand-surface w-40" autofocus />
											{:else}
												<button onclick={() => startEditGlobalParam(pg.name)} class="bg-transparent border-0 border-b border-dashed border-brand-muted cursor-pointer text-brand-text hover:text-brand-primary hover:border-brand-primary text-left font-medium">{pg.name}</button>
											{/if}
											{#if pg.warnings.length > 0}
												<div class="text-xs text-severity-warning mt-0.5">{pg.warnings[0]}</div>
											{/if}
										</td>
										<td class="px-3 py-2 text-xs">
											{#if matched}
												<span class="text-brand-muted" title="Already exists in the database — edit via the Parameters page">{matched.default_units}</span>
											{:else if editingGlobalUnits === pg.name}
												<input type="text" bind:value={editUnitsValue} onkeydown={(e) => { if (e.key === 'Enter') commitEditUnits(); if (e.key === 'Escape') editingGlobalUnits = null; }} onblur={commitEditUnits} class="px-1 py-0.5 border border-brand-primary rounded text-xs bg-brand-surface w-20" autofocus />
											{:else}
												<button onclick={() => startEditUnits(pg.name, pg.units)} class="bg-transparent border-0 border-b border-dashed border-brand-muted cursor-pointer text-brand-muted hover:text-brand-primary hover:border-brand-primary">{pg.units || '--'}</button>
											{/if}
										</td>
										<td class="px-4 py-2">
											<select
												value={matched ? `db:${matched.id}` : `new:${pg.name}`}
												onchange={(e) => {
													const val = (e.target as HTMLSelectElement).value;
													if (val.startsWith('db:')) {
														const ep = existingParams.find((p) => p.id === val.slice(3));
														if (ep) mapParamToExisting(pg.name, ep);
													} else if (val.startsWith('new:')) {
														const newName = val.slice(4);
														if (newName !== pg.name) renameGlobalParam(pg.name, newName);
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
													{#each paramGroups.filter((p) => !existingParams.some((ep) => ep.code === p.name)) as newP}
														<option value="new:{newP.name}">+ {newP.name} ({newP.units})</option>
													{/each}
												</optgroup>
											</select>
										</td>
										<td class="px-4 py-2">
											<span class="text-xs px-1.5 py-0.5 rounded {matched ? 'bg-severity-ok-soft text-severity-ok' : 'bg-severity-warning-soft text-severity-warning'}">{matched ? 'existing' : 'new'}</span>
										</td>
										<td class="px-4 py-2 text-right text-brand-muted">{pg.siteCount}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>

				<!-- ── WARNINGS TAB ── -->
				{:else if reviewTab === 'warnings'}
					{#if uniqueWarnings.length === 0}
						<p class="text-sm text-severity-ok">No warnings in this plan.</p>
					{:else}
						<p class="text-xs text-brand-muted mb-2">
							Click a warning to jump to the parameter. Resolve by renaming it (creates a new parameter with the source's units) or keep the mapping if the difference is only notation.
						</p>
						<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
							<table class="w-full text-sm">
								<thead><tr class="bg-brand-bg border-b border-brand-divider">
									<th class="text-left px-4 py-2 font-semibold">Warning</th>
									<th class="text-left px-4 py-2 font-semibold">Parameter</th>
									<th class="text-right px-4 py-2 font-semibold">Affected streams</th>
								</tr></thead>
								<tbody>
									{#each uniqueWarnings as w}
										<tr
											data-warning={w.message}
											class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50 cursor-pointer"
											onclick={() => jumpToParamRow(w.paramName)}
											title="Jump to {w.paramName} in Parameters tab"
										>
											<td class="px-4 py-2 text-severity-warning text-xs">{w.message}</td>
											<td class="px-4 py-2 font-medium text-brand-primary underline-offset-2 hover:underline">{w.paramName}</td>
											<td class="px-4 py-2 text-right text-brand-muted">{w.count.toLocaleString()}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				{/if}
			</div>
		</div>
	</div>

<!-- ════════════════════ CONFIRM ════════════════════ -->
{:else if mode === 'confirm' && plan}
	<div class="space-y-4 max-w-xl mx-auto">
		<div class="flex items-center gap-3">
			<button onclick={() => setMode('review')} class="text-sm text-brand-primary bg-transparent border-none cursor-pointer hover:underline">&larr; Back to review</button>
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
				{#if summary.warnings > 0}
					<div class="p-3 bg-severity-warning-soft rounded"><span class="text-severity-warning block text-xs">Warnings</span><span class="text-lg font-semibold text-severity-warning">{summary.warnings}</span></div>
				{/if}
			</div>

			<p class="text-xs text-brand-muted">Readings will be backfilled with site and parameter IDs. Continuous aggregates will refresh in the background. This operation can be reverted.</p>

			<div class="flex gap-3 pt-2">
				<button onclick={() => setMode('review')} class="px-4 py-2 border border-brand-divider rounded-md text-sm cursor-pointer bg-brand-surface">Back to Review</button>
				<button onclick={applyPlan} disabled={applying} class="px-4 py-2 bg-brand-primary text-white rounded-md text-sm font-semibold cursor-pointer border-none disabled:opacity-50">
					{applying ? 'Applying...' : 'Apply Plan'}
				</button>
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
				<div><span class="text-brand-muted block text-xs">Streams paired</span><span class="text-lg font-semibold text-severity-ok">{applyResult.streams_paired.toLocaleString()}</span></div>
				<div><span class="text-brand-muted block text-xs">Readings backfilled</span><span class="text-lg font-semibold">{applyResult.readings_backfilled.toLocaleString()}</span></div>
			</div>
		</div>

		<div class="flex gap-3">
			<button onclick={exitWizard} class="px-4 py-2 bg-brand-primary text-white rounded-md text-sm font-semibold cursor-pointer border-none">Done</button>
			<ConfirmPopover message="Revert this plan? All pairings will be undone." confirmLabel="Revert" onconfirm={revertPlan}>
				<button disabled={reverting} class="px-4 py-2 border border-severity-alarm text-severity-alarm rounded-md text-sm cursor-pointer bg-transparent disabled:opacity-50">
					{reverting ? 'Reverting...' : 'Revert Plan'}
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
		<button onclick={() => pairDialogOpen = false} class="px-3 py-1.5 border border-brand-divider rounded-md text-sm cursor-pointer bg-brand-surface">Cancel</button>
		<button onclick={handlePair} disabled={!selectedSiteParam || pairing} class="px-3 py-1.5 bg-brand-primary text-white rounded-md text-sm cursor-pointer border-none disabled:opacity-50">{pairing ? 'Pairing...' : 'Pair'}</button>
	{/snippet}
</Dialog>

<Dialog bind:open={importDialogOpen} title="Import Sensor" maxWidth="sm">
	{#snippet children()}
		{#if importStream_}
			<div class="space-y-3">
				<div class="text-sm"><span class="text-brand-muted">Stream:</span> <span class="font-mono">{importStream_.source_key}</span></div>
				<p class="text-xs text-brand-muted">Registers this stream's device into the sensor inventory (creates the sensor + identity calibration and stamps its existing readings) without assigning it to a site. Pair the stream separately to attribute its data to a site.</p>
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
		<button onclick={() => importDialogOpen = false} class="px-3 py-1.5 border border-brand-divider rounded-md text-sm cursor-pointer bg-brand-surface">Cancel</button>
		<button onclick={handleImport} disabled={!importParamId || importing} class="px-3 py-1.5 bg-brand-primary text-white rounded-md text-sm cursor-pointer border-none disabled:opacity-50">{importing ? 'Importing...' : 'Import'}</button>
	{/snippet}
</Dialog>

<Dialog bind:open={statsDialogOpen} title="Stream Stats" maxWidth="xs">
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
					</div>
				{:else}
					<p class="text-brand-muted">Loading stats...</p>
				{/if}
			</div>
		{/if}
	{/snippet}
	{#snippet actions()}
		<button onclick={() => statsDialogOpen = false} class="px-3 py-1.5 border border-brand-divider rounded-md text-sm cursor-pointer bg-brand-surface">Close</button>
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
