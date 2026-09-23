<script lang="ts">
	import { base } from '$app/paths';
	import { api, type CollectionEvent } from '$api/crud';
	import { stageCollectionEvent, type StagedEvent } from '$api/service';
	import { newEntryRequest } from '$lib/dataEntry/entry';
	import { stagedVisit } from '$lib/stores/visit.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { SYNCED_VISIT_NOTICE } from '$lib/visits/recompute';
	import { apiMessage } from '$lib/standardCurves';
	import { formatDateTime } from '$lib/utils';
	import Badge from '$components/ui/Badge.svelte';
	import Button from '$components/ui/Button.svelte';
	import TimestampInput from '$components/ui/TimestampInput.svelte';
	import SiteSelect from '$components/SiteSelect.svelte';
	import { siteRefs } from '$lib/siteRefs.svelte';

	// The field visit a tool run attaches to, chosen here from the station's visits or added at a
	// typed time. Every run and save on this page writes into it.

	let changing = $state(false);
	let siteId = $state(stagedVisit.current?.siteId ?? '');
	let collectedAt = $state('');
	let adding = $state(false);
	let recent = $state<CollectionEvent[]>([]);
	let recentLoading = $state(false);
	let siteSelect = $state<HTMLDivElement | null>(null);

	const visit = $derived(stagedVisit.current);
	const picking = $derived(!visit || changing);
	const detail = $derived(stagedVisit.detail);
	const recordedCells = $derived((detail?.cells ?? []).filter((c) => c.served_value != null));

	// A visit restored from the session has no grid yet; load it once per chosen event.
	let summarised = '';
	$effect(() => {
		const id = visit?.eventId;
		if (!id || id === summarised) return;
		summarised = id;
		void stagedVisit.refresh();
	});

	// The station's visits are listed as soon as a station is picked.
	let listed = '';
	$effect(() => {
		if (!picking || siteId === listed) return;
		listed = siteId;
		void loadRecent();
	});

	/** Return to the picker, on the station already chosen, and put the focus on it. */
	export function begin() {
		changing = true;
		siteId = visit?.siteId ?? siteId;
		queueMicrotask(() => siteSelect?.querySelector('select')?.focus());
	}

	async function loadRecent() {
		recent = [];
		if (!siteId) return;
		const asked = siteId;
		recentLoading = true;
		try {
			const res = await api.collectionEvents.list({
				perPage: 15,
				sort: ['collected_at', 'DESC'],
				filter: { site_id: asked },
			});
			if (asked === siteId) recent = res.data;
		} catch {
			recent = [];
		} finally {
			recentLoading = false;
		}
	}

	function choose(event: CollectionEvent | StagedEvent) {
		stagedVisit.set({
			eventId: event.id,
			siteId: event.site_id,
			siteName: siteRefs.name(event.site_id),
			collectedAt: event.collected_at,
		});
		changing = false;
	}

	async function add() {
		const made = newEntryRequest(siteId, collectedAt);
		if ('error' in made) {
			toastStore.error(made.error);
			return;
		}
		adding = true;
		try {
			const staged = await stageCollectionEvent(made.request);
			await siteRefs.ensure();
			choose(staged);
			collectedAt = '';
			listed = '';
		} catch (e) {
			toastStore.error(apiMessage(e));
		} finally {
			adding = false;
		}
	}
</script>

<div class="rounded-md border border-brand-divider bg-brand-surface p-3">
	{#if !picking && visit}
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
		<div class="space-y-3">
			<div class="flex flex-wrap items-end gap-3">
				<div bind:this={siteSelect}>
					<label for="svb-site" class="block text-xs text-brand-muted mb-0.5">Station</label>
					<SiteSelect id="svb-site" bind:value={siteId} ariaLabel="Station" />
				</div>
				<div>
					<span class="block text-xs text-brand-muted mb-0.5">New visit at</span>
					<TimestampInput bind:value={collectedAt} ariaLabel="New visit at" compact />
				</div>
				<Button variant="primary" onclick={add} disabled={adding || !siteId}>
					{adding ? 'Adding…' : 'Add visit'}
				</Button>
				{#if changing}
					<Button variant="ghost" onclick={() => (changing = false)}>Cancel</Button>
				{/if}
			</div>

			{#if !siteId}
				<p class="text-xs text-brand-muted">
					Choose the station you are working on, then one of its visits or a new one: every form
					you run writes its parameters into that visit.
				</p>
			{:else if recentLoading}
				<p class="text-xs text-brand-muted">Loading visits…</p>
			{:else if recent.length === 0}
				<p class="text-xs text-brand-muted">No visits at this station yet. Add one above.</p>
			{:else}
				<div>
					<p class="text-xs font-semibold mb-1">Visits at this station</p>
					<ul class="flex flex-wrap gap-2" aria-label="Visits at this station">
						{#each recent as e (e.id)}
							<li><button
								type="button"
								onclick={() => choose(e)}
								title={e.source === 'portal_sync' ? SYNCED_VISIT_NOTICE : undefined}
								class="px-2 py-1.5 text-xs rounded-md border border-brand-divider hover:bg-brand-bg cursor-pointer flex items-center gap-2"
							>
								<span>{formatDateTime(e.collected_at)}</span>
								<Badge variant={e.source === 'portal_sync' ? 'accent' : 'muted'}
									>{e.source === 'portal_sync' ? 'sync' : e.source}</Badge
								>
							</button></li>
						{/each}
					</ul>
					{#if recent.some((e) => e.source === 'portal_sync')}
						<p class="text-xs text-brand-muted mt-1">{SYNCED_VISIT_NOTICE}</p>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>
