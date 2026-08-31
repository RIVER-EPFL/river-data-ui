<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { getList } from '$api/client';
	import { api } from '$api/crud';
	import EventPanel from '$components/logs/EventPanel.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import Breadcrumbs from '$components/ui/Breadcrumbs.svelte';
	import { formatDateTime } from '$lib/utils';

	// One row per collection event (field visit) across sites; the site's Visits tab holds the
	// full grid, this list is the way in.
	interface CollectionEventRow {
		id: string;
		site_id: string;
		collected_at: string;
		source: 'manual' | 'portal_sync' | string;
		created_by: string | null;
		notes: string | null;
	}

	let siteNames = $state<Map<string, string>>(new Map());
	let siteFilter = $state('');
	let panel = $state<{ reload: () => Promise<void> } | null>(null);

	onMount(async () => {
		try {
			const sites = await api.sites.list({ perPage: 500, sort: ['name', 'ASC'] });
			siteNames = new Map(sites.data.map((s) => [s.id, s.name]));
		} catch {
			// The list still renders with raw ids.
		}
	});

	async function fetchPage({ page, perPage }: { page: number; perPage: number }) {
		const filter: Record<string, unknown> = {};
		if (siteFilter) filter.site_id = siteFilter;
		return getList<CollectionEventRow>('/api/collection_events', {
			page,
			perPage,
			sort: ['collected_at', 'DESC'],
			filter,
		});
	}

	function open(item: CollectionEventRow) {
		goto(`${base}/sites/${item.site_id}?tab=visits&event=${item.id}`);
	}
</script>

<svelte:head><title>Visits · RIVER Data</title></svelte:head>

<div class="space-y-4">
	<Breadcrumbs items={[{ label: 'Visits' }]} />
	<p class="text-sm text-brand-muted">
		Every field visit (collection event) across sites. A row opens the site's Visits tab, the
		full grid of what that date recorded.
	</p>

	<EventPanel bind:this={panel} {fetchPage} perPage={100} colCount={5} onRowClick={open}>
		{#snippet filterBar({ reload })}
			<div class="flex items-center gap-2">
				<select
					bind:value={siteFilter}
					onchange={() => reload()}
					class="px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-sm"
				>
					<option value="">All sites</option>
					{#each [...siteNames.entries()] as [id, name] (id)}
						<option value={id}>{name}</option>
					{/each}
				</select>
			</div>
		{/snippet}
		{#snippet head()}
			<th class="text-left px-4 py-2 font-semibold">Date</th>
			<th class="text-left px-4 py-2 font-semibold">Site</th>
			<th class="text-left px-4 py-2 font-semibold">Source</th>
			<th class="text-left px-4 py-2 font-semibold">By</th>
			<th class="text-left px-4 py-2 font-semibold">Notes</th>
		{/snippet}
		{#snippet row(item)}
			<td class="px-4 py-2 text-xs whitespace-nowrap">{formatDateTime(item.collected_at)}</td>
			<td class="px-4 py-2 text-xs">{siteNames.get(item.site_id) ?? item.site_id}</td>
			<td class="px-4 py-2">
				{#if item.source === 'portal_sync'}
					<Badge variant="accent">portal</Badge>
				{:else}
					<Badge variant="muted">manual</Badge>
				{/if}
			</td>
			<td class="px-4 py-2 text-xs text-brand-muted">{item.created_by ?? '—'}</td>
			<td class="px-4 py-2 text-xs text-brand-muted truncate max-w-64">{item.notes ?? ''}</td>
		{/snippet}
	</EventPanel>
</div>
