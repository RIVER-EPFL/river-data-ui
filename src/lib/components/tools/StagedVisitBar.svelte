<script lang="ts">
	import { base } from '$app/paths';
	import { api, type CollectionEvent } from '$api/crud';
	import type { StagedEvent } from '$api/service';
	import { stagedVisit } from '$lib/stores/visit.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { SYNCED_VISIT_NOTICE } from '$lib/visits/recompute';
	import { formatDateTime } from '$lib/utils';
	import Badge from '$components/ui/Badge.svelte';
	import Button from '$components/ui/Button.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import SiteSelect from '$components/SiteSelect.svelte';
	import NewVisitDialog from '$components/visits/NewVisitDialog.svelte';
	import { siteRefs } from '$lib/siteRefs.svelte';

	// The field visit a tool run attaches to: one is chosen from the site's visits, and every run
	// and save on this page writes into it. New visit adds one to the same table the Visits page
	// lists.

	let open = $state(false);
	let siteId = $state('');
	let newVisitOpen = $state(false);
	let recent = $state<CollectionEvent[]>([]);
	let recentLoading = $state(false);

	const visit = $derived(stagedVisit.current);
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

	export function begin() {
		open = true;
		siteId = visit?.siteId ?? siteId;
		void siteRefs.ensure().catch((e) =>
			toastStore.error(e instanceof Error ? e.message : 'Failed to load sites'),
		);
		void loadRecent();
	}

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
		return siteRefs.name(id);
	}

	function choose(event: CollectionEvent | StagedEvent) {
		stagedVisit.set({
			eventId: event.id,
			siteId: event.site_id,
			siteName: siteName(event.site_id),
			collectedAt: event.collected_at,
		});
		open = false;
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
				<p class="text-sm font-semibold">No field visit chosen</p>
				<p class="text-xs text-brand-muted">
					Choose the site and date you are working on, then every tool you run writes its
					parameters into that visit.
				</p>
			</div>
			<div class="ml-auto">
				<Button variant="primary" size="sm" onclick={begin}>Choose a field visit</Button>
			</div>
		</div>
	{/if}
</div>

<Dialog bind:open title="Choose a field visit" maxWidth="sm">
	{#snippet children()}
		<div class="space-y-3">
			<div class="flex flex-col gap-1">
				<label for="svb-site" class="text-sm font-medium">Site <span class="text-severity-alarm">*</span></label>
				<SiteSelect id="svb-site" bind:value={siteId} onchange={loadRecent} />
			</div>

			{#if siteId}
				<div class="space-y-1">
					<div class="flex items-center justify-between gap-2">
						<p class="text-xs font-semibold">Visits at this site</p>
						<Button size="sm" variant="secondary" onclick={() => (newVisitOpen = true)}>New visit</Button>
					</div>
					{#if recentLoading}
						<p class="text-xs text-brand-muted">Loading…</p>
					{:else if recent.length === 0}
						<p class="text-xs text-brand-muted">None yet. New visit adds the first.</p>
					{:else}
						<div class="max-h-40 overflow-y-auto divide-y divide-brand-divider border border-brand-divider rounded-md">
							{#each recent as e (e.id)}
								<button
									type="button"
									onclick={() => choose(e)}
									title={e.source === 'portal_sync' ? SYNCED_VISIT_NOTICE : undefined}
									class="w-full text-left px-2 py-1.5 text-xs hover:bg-brand-bg cursor-pointer flex items-center justify-between gap-2"
								>
									<span>
										{formatDateTime(e.collected_at)}
										{#if e.source === 'portal_sync'}
											<span class="block text-brand-muted">{SYNCED_VISIT_NOTICE}</span>
										{/if}
									</span>
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
	{/snippet}
</Dialog>

<NewVisitDialog bind:open={newVisitOpen} {siteId} onadded={(event) => { newVisitOpen = false; choose(event); }} />
