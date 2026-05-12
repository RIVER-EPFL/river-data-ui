<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { api, type DataStream, type SiteParameter, type Site, type Parameter } from '$api/crud';
	import { pairStream, unpairStream, getStreamStats, createPairingPlan, applyPairingPlan, getUnpairedSummary, type PairingPlan, type StreamStats } from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatRelativeTime } from '$lib/utils';
	import Dialog from '$components/ui/Dialog.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';

	let streams = $state<DataStream[]>([]);
	let siteParams = $state<SiteParameter[]>([]);
	let sites = $state<Site[]>([]);
	let params = $state<Parameter[]>([]);
	let total = $state(0);
	let loading = $state(true);
	let filter = $state<'all' | 'paired' | 'unpaired'>('all');
	let currentPage = $state(1);
	const perPage = 25;
	const totalPages = $derived(Math.ceil(total / perPage));

	// Pair dialog
	let pairDialogOpen = $state(false);
	let pairStream_ = $state<DataStream | null>(null);
	let selectedSiteParam = $state('');
	let pairing = $state(false);

	// Stats dialog
	let statsDialogOpen = $state(false);
	let statsStream = $state<DataStream | null>(null);
	let stats = $state<StreamStats | null>(null);

	// Pairing wizard
	let wizardOpen = $state(false);
	let wizardPlan = $state<PairingPlan | null>(null);
	let wizardStep = $state(0);
	let wizardApplying = $state(false);
	let unpairedSummary = $state<Array<{ source_system: string; unpaired: number; paired: number }>>([]);

	async function load() {
		loading = true;
		try {
			const f: Record<string, unknown> = {};
			if (filter === 'paired') f.site_parameter_id = '__not_null__';
			if (filter === 'unpaired') f.site_parameter_id = '__null__';

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
		return `${site?.name ?? '?'} / ${param?.display_name ?? '?'}`;
	}

	function openPairDialog(stream: DataStream) {
		pairStream_ = stream; selectedSiteParam = ''; pairDialogOpen = true;
	}

	async function handlePair() {
		if (!pairStream_ || !selectedSiteParam) return;
		pairing = true;
		try {
			await pairStream(pairStream_.id, selectedSiteParam);
			toastStore.success('Stream paired');
			pairDialogOpen = false;
			load();
		} catch { toastStore.error('Pairing failed'); }
		finally { pairing = false; }
	}

	async function handleUnpair(streamId: string) {
		try { await unpairStream(streamId); toastStore.success('Stream unpaired'); load(); }
		catch { toastStore.error('Unpair failed'); }
	}

	async function openStats(stream: DataStream) {
		statsStream = stream; stats = null; statsDialogOpen = true;
		try { stats = await getStreamStats(stream.id); }
		catch { toastStore.error('Failed to load stats'); }
	}

	async function openWizard() {
		wizardOpen = true; wizardStep = 0; wizardPlan = null;
		try { unpairedSummary = await getUnpairedSummary(); }
		catch { toastStore.error('Failed to load unpaired summary'); }
	}

	async function startWizardPlan(sourceSystem: string) {
		try { wizardPlan = await createPairingPlan(sourceSystem); wizardStep = 1; }
		catch { toastStore.error('Failed to create pairing plan'); }
	}

	async function applyWizard() {
		if (!wizardPlan) return;
		wizardApplying = true;
		try {
			const result = await applyPairingPlan(wizardPlan.id);
			toastStore.success(`Paired ${result.streams_paired} streams, backfilled ${result.readings_backfilled} readings`);
			wizardOpen = false;
			load();
		} catch { toastStore.error('Failed to apply pairing plan'); }
		finally { wizardApplying = false; }
	}

	onMount(load);
</script>

<svelte:head><title>Streams | River Data</title></svelte:head>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h2 class="text-xl font-semibold">Data Streams</h2>
		<button onclick={openWizard} class="px-3 py-1.5 bg-brand-primary text-white rounded-md text-sm font-semibold cursor-pointer border-none hover:bg-brand-primary-dark">Discover & Pair</button>
	</div>

	<div class="flex gap-1">
		{#each ['all', 'paired', 'unpaired'] as f}
			<button
				onclick={() => { filter = f as typeof filter; currentPage = 1; load(); }}
				class="px-3 py-1 text-sm rounded-md cursor-pointer border-none {filter === f ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted hover:text-brand-text'}"
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
							<td class="px-4 py-2 text-xs">{stream.source_name ?? '—'}</td>
							<td class="px-4 py-2 text-xs text-brand-muted">{stream.source_system}</td>
							<td class="px-4 py-2 text-xs {stream.site_parameter_id ? 'text-severity-ok' : 'text-brand-muted'}">{siteParamLabel(stream.site_parameter_id)}</td>
							<td class="px-4 py-2 text-xs text-brand-muted">{stream.last_data_time ? formatRelativeTime(stream.last_data_time) : '—'}</td>
							<td class="px-4 py-2 flex gap-2">
								<button onclick={() => openStats(stream)} class="text-xs text-brand-primary bg-transparent border-none cursor-pointer hover:underline">Stats</button>
								{#if stream.site_parameter_id}
									<ConfirmPopover message="Unpair this stream?" confirmLabel="Unpair" onconfirm={() => handleUnpair(stream.id)}>
										<button class="text-xs text-severity-alarm bg-transparent border-none cursor-pointer hover:underline">Unpair</button>
									</ConfirmPopover>
								{:else}
									<button onclick={() => openPairDialog(stream)} class="text-xs text-brand-primary bg-transparent border-none cursor-pointer hover:underline">Pair</button>
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

<!-- Pair Dialog -->
<Dialog bind:open={pairDialogOpen} title="Pair Stream" maxWidth="sm">
	{#snippet children()}
		{#if pairStream_}
			<div class="space-y-3">
				<div class="text-sm"><span class="text-brand-muted">Stream:</span> <span class="font-mono">{pairStream_.source_key}</span></div>
				<div class="flex flex-col gap-1">
					<label for="sp-select" class="text-sm font-medium">Site Parameter</label>
					<select id="sp-select" bind:value={selectedSiteParam} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
						<option value="">— Select —</option>
						{#each siteParams as sp}
							<option value={sp.id}>{siteParamLabel(sp.id)}</option>
						{/each}
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

<!-- Stats Dialog -->
<Dialog bind:open={statsDialogOpen} title="Stream Stats" maxWidth="xs">
	{#snippet children()}
		{#if statsStream}
			<div class="space-y-2 text-sm">
				<div><span class="text-brand-muted">Stream:</span> <span class="font-mono">{statsStream.source_key}</span></div>
				{#if stats}
					<div class="grid grid-cols-2 gap-2 mt-2">
						<div><span class="text-brand-muted block">Readings</span>{stats.reading_count.toLocaleString()}</div>
						<div><span class="text-brand-muted block">Latest Value</span>{stats.latest_value ?? '—'}</div>
						<div><span class="text-brand-muted block">Min Time</span><span class="text-xs">{stats.min_time ?? '—'}</span></div>
						<div><span class="text-brand-muted block">Max Time</span><span class="text-xs">{stats.max_time ?? '—'}</span></div>
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

<!-- Pairing Wizard -->
<Dialog bind:open={wizardOpen} title="Discover & Pair Streams" maxWidth="md">
	{#snippet children()}
		{#if wizardStep === 0}
			<div class="space-y-3">
				<p class="text-sm">Select a source system to discover unpaired streams:</p>
				{#each unpairedSummary as summary}
					<button onclick={() => startWizardPlan(summary.source_system)} class="w-full p-3 text-left border border-brand-divider rounded-md hover:bg-brand-bg cursor-pointer bg-brand-surface">
						<div class="font-semibold text-sm">{summary.source_system}</div>
						<div class="text-xs text-brand-muted">{summary.unpaired} unpaired / {summary.paired} paired</div>
					</button>
				{/each}
				{#if unpairedSummary.length === 0}
					<p class="text-sm text-brand-muted">No source systems found.</p>
				{/if}
			</div>
		{:else if wizardStep === 1 && wizardPlan}
			<div class="space-y-3">
				<div class="grid grid-cols-3 gap-3 text-sm">
					<div class="p-3 bg-brand-bg rounded"><span class="text-brand-muted block">To pair</span><span class="text-lg font-semibold">{wizardPlan.summary.will_pair}</span></div>
					<div class="p-3 bg-brand-bg rounded"><span class="text-brand-muted block">To skip</span><span class="text-lg font-semibold">{wizardPlan.summary.will_skip}</span></div>
					<div class="p-3 bg-brand-bg rounded"><span class="text-brand-muted block">New entities</span><span class="text-lg font-semibold">{wizardPlan.summary.sites_to_create + wizardPlan.summary.parameters_to_create}</span></div>
				</div>
				<div class="max-h-60 overflow-y-auto rounded border border-brand-divider">
					<table class="w-full text-xs">
						<thead><tr class="bg-brand-bg border-b border-brand-divider sticky top-0">
							<th class="text-left px-3 py-1.5">Stream</th>
							<th class="text-left px-3 py-1.5">Site</th>
							<th class="text-left px-3 py-1.5">Parameter</th>
							<th class="text-left px-3 py-1.5">Action</th>
						</tr></thead>
						<tbody>
							{#each wizardPlan.entries as entry}
								<tr class="border-b border-brand-divider last:border-b-0">
									<td class="px-3 py-1 font-mono">{entry.source_key}</td>
									<td class="px-3 py-1">{entry.site.name} {entry.site.create ? '(new)' : ''}</td>
									<td class="px-3 py-1">{entry.parameter.name}</td>
									<td class="px-3 py-1"><span class="px-1.5 py-0.5 rounded {entry.action === 'pair' ? 'bg-severity-ok-soft text-severity-ok' : 'bg-brand-bg text-brand-muted'}">{entry.action}</span></td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}
	{/snippet}
	{#snippet actions()}
		<button onclick={() => wizardOpen = false} class="px-3 py-1.5 border border-brand-divider rounded-md text-sm cursor-pointer bg-brand-surface">Cancel</button>
		{#if wizardStep === 1 && wizardPlan}
			<button onclick={applyWizard} disabled={wizardApplying} class="px-3 py-1.5 bg-brand-primary text-white rounded-md text-sm cursor-pointer border-none disabled:opacity-50">{wizardApplying ? 'Applying...' : 'Apply Plan'}</button>
		{/if}
	{/snippet}
</Dialog>
