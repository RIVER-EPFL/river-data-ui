<script lang="ts">
	import { base } from '$app/paths';
	import { api, type CollectionEvent, type Site } from '$api/crud';
	import { listAll } from '$api/paged';
	import { stageCollectionEvent } from '$api/service';
	import { stagedVisit } from '$lib/stores/visit.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatDateTime, toDatetimeLocal, fromDatetimeLocal } from '$lib/utils';
	import Badge from '$components/ui/Badge.svelte';
	import Button from '$components/ui/Button.svelte';
	import Dialog from '$components/ui/Dialog.svelte';

	// Staging a field visit before running a tool: the station and instant are chosen once, and
	// every tool run and save on this page attaches to that visit. An existing visit at the chosen
	// instant is adopted rather than duplicated, so a second tool lands on the same row.

	const BROWSER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

	let open = $state(false);
	let sites = $state<Site[]>([]);
	let siteId = $state('');
	let when = $state(toDatetimeLocal(Date.now(), BROWSER_ZONE));
	let notes = $state('');
	let staging = $state(false);
	let recent = $state<CollectionEvent[]>([]);
	let recentLoading = $state(false);

	const visit = $derived(stagedVisit.current);
	const detail = $derived(stagedVisit.detail);
	const recordedCells = $derived((detail?.cells ?? []).filter((c) => c.served_value != null));

	// A visit restored from the session has no grid yet; load it once per staged event.
	let summarised = '';
	$effect(() => {
		const id = visit?.eventId;
		if (!id || id === summarised) return;
		summarised = id;
		void stagedVisit.refresh();
	});

	export function begin() {
		open = true;
		siteId = visit?.siteId ?? siteId;
		when = visit ? toDatetimeLocal(Date.parse(visit.collectedAt), BROWSER_ZONE) : when;
		notes = '';
		void loadSites();
	}

	async function loadSites() {
		if (sites.length > 0) return;
		try {
			sites = await listAll(api.sites, { perPage: 200, sort: ['name', 'ASC'] });
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to load stations');
		}
	}

	// The station's recent visits, so a return trip to an already-staged date is a click.
	async function loadRecent() {
		recent = [];
		if (!siteId) return;
		recentLoading = true;
		try {
			const res = await api.collectionEvents.list({
				perPage: 15,
				sort: ['collected_at', 'DESC'],
				filter: { site_id: siteId },
			});
			recent = res.data;
		} catch {
			recent = [];
		} finally {
			recentLoading = false;
		}
	}

	function siteName(id: string): string {
		return sites.find((s) => s.id === id)?.name ?? id;
	}

	function adopt(event: CollectionEvent) {
		stagedVisit.set({
			eventId: event.id,
			siteId: event.site_id,
			siteName: siteName(event.site_id),
			collectedAt: event.collected_at,
		});
		open = false;
	}

	// Staging is find-or-create server-side, so entering a visit that already stands joins it
	// rather than colliding with the unique key.
	async function stage() {
		if (!siteId || !when) {
			toastStore.error('Choose a station and a collection time');
			return;
		}
		staging = true;
		try {
			const event = await stageCollectionEvent({
				site_id: siteId,
				collected_at: fromDatetimeLocal(when, BROWSER_ZONE),
				...(notes.trim() ? { notes: notes.trim() } : {}),
			});
			stagedVisit.set({
				eventId: event.id,
				siteId: event.site_id,
				siteName: siteName(event.site_id),
				collectedAt: event.collected_at,
			});
			toastStore.success(event.created ? 'Field visit staged' : 'Staged the existing visit');
			open = false;
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to stage the visit');
		} finally {
			staging = false;
		}
	}
</script>

<div class="rounded-md border border-brand-divider bg-brand-surface p-3">
	{#if visit}
		<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
			<div class="flex items-baseline gap-2">
				<span class="text-xs uppercase tracking-wide text-brand-muted">Field visit</span>
				<span class="text-sm font-semibold">{visit.siteName || visit.siteId}</span>
				<span class="text-sm">{formatDateTime(visit.collectedAt)}</span>
			</div>
			{#if stagedVisit.detailLoading}
				<span class="text-xs text-brand-muted">Loading what this visit records…</span>
			{:else if recordedCells.length > 0}
				<div class="flex flex-wrap items-center gap-1">
					{#each recordedCells as cell (cell.parameter_id)}
						<Badge variant="muted">{cell.parameter_code}</Badge>
					{/each}
				</div>
			{:else}
				<span class="text-xs text-brand-muted">Nothing recorded yet.</span>
			{/if}
			<div class="ml-auto flex items-center gap-2">
				<a
					href="{base}/sites/{visit.siteId}?tab=visits&event={visit.eventId}"
					class="text-xs text-brand-primary hover:underline">Open visit</a
				>
				<Button variant="secondary" size="sm" onclick={begin}>Change</Button>
				<Button variant="ghost" size="sm" onclick={() => stagedVisit.clear()}>Clear</Button>
			</div>
		</div>
	{:else}
		<div class="flex flex-wrap items-center gap-3">
			<div>
				<p class="text-sm font-semibold">No field visit staged</p>
				<p class="text-xs text-brand-muted">
					Stage a station and collection time, then every tool you run writes its parameters
					into that visit.
				</p>
			</div>
			<div class="ml-auto">
				<Button variant="primary" size="sm" onclick={begin}>Stage a field visit</Button>
			</div>
		</div>
	{/if}
</div>

<Dialog bind:open title="Stage a field visit" maxWidth="sm">
	{#snippet children()}
		<div class="space-y-3">
			<div class="grid grid-cols-2 gap-3">
				<div class="flex flex-col gap-1">
					<label for="svb-site" class="text-sm font-medium">Station <span class="text-severity-alarm">*</span></label>
					<select
						id="svb-site"
						bind:value={siteId}
						onchange={loadRecent}
						class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
					>
						<option value=""> - Select station - </option>
						{#each sites as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
					</select>
				</div>
				<div class="flex flex-col gap-1">
					<label for="svb-time" class="text-sm font-medium">Collection time <span class="text-severity-alarm">*</span></label>
					<input
						id="svb-time"
						type="datetime-local"
						bind:value={when}
						class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
					/>
					<span class="text-xs text-brand-muted">{BROWSER_ZONE}</span>
				</div>
			</div>
			<div class="flex flex-col gap-1">
				<label for="svb-notes" class="text-sm font-medium">
					Notes <span class="text-brand-muted font-normal">(optional)</span>
				</label>
				<input
					id="svb-notes"
					bind:value={notes}
					class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
				/>
			</div>

			{#if siteId}
				<div class="space-y-1">
					<p class="text-xs font-semibold">Recent visits at this station</p>
					{#if recentLoading}
						<p class="text-xs text-brand-muted">Loading…</p>
					{:else if recent.length === 0}
						<p class="text-xs text-brand-muted">None yet.</p>
					{:else}
						<div class="max-h-40 overflow-y-auto divide-y divide-brand-divider border border-brand-divider rounded-md">
							{#each recent as e (e.id)}
								<button
									type="button"
									onclick={() => adopt(e)}
									class="w-full text-left px-2 py-1.5 text-xs hover:bg-brand-bg cursor-pointer flex items-center justify-between gap-2"
								>
									<span>{formatDateTime(e.collected_at)}</span>
									<Badge variant={e.source === 'portal_sync' ? 'accent' : 'muted'}>{e.source === 'portal_sync' ? 'sync' : e.source}</Badge>
								</button>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{/snippet}
	{#snippet actions()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" loading={staging} onclick={stage}>
			{staging ? 'Staging…' : 'Stage visit'}
		</Button>
	{/snippet}
</Dialog>
