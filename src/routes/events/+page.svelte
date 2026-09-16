<script lang="ts">
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { listVisits, type VisitListRow, type VisitListSort } from '$api/service';
	import EventPanel from '$components/logs/EventPanel.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import Button from '$components/ui/Button.svelte';
	import Breadcrumbs from '$components/ui/Breadcrumbs.svelte';
	import SiteSelect from '$components/SiteSelect.svelte';
	import NewVisitDialog from '$components/visits/NewVisitDialog.svelte';
	import PendingVerifications from '$components/visits/PendingVerifications.svelte';
	import { me } from '$auth/me.svelte';
	import { RECOMPUTE_BADGE } from '$lib/visits/recompute';
	import { verificationBadge } from '$lib/visits/verification';
	import { formatDateTime } from '$lib/utils';

	// One row per collection event (field visit) across sites, with the fill and open-finding
	// counts the site's Visits tab computes; a row opens that tab on the visit.
	let siteFilter = $state('');
	let sort = $state<VisitListSort>('collected_at');
	let order = $state<'asc' | 'desc'>('desc');
	let panel = $state<{ reload: () => Promise<void> } | null>(null);
	let newVisitOpen = $state(false);
	// A manager rules on what an intern entered here: the pending field days and values.
	const canVerify = $derived(me.can('manageSensors'));
	// A hold chip on a pending reading lands here on the pending list.
	let pendingView = $state(page.url.searchParams.has('pending'));

	async function loadPage({ page, perPage }: { page: number; perPage: number }) {
		const r = await listVisits({
			page,
			page_size: perPage,
			sort,
			order,
			...(siteFilter ? { site_id: siteFilter } : {}),
		});
		return { data: r.items, total: r.total };
	}

	function toggleSort(column: VisitListSort, reload: () => Promise<void>) {
		if (sort === column) {
			order = order === 'desc' ? 'asc' : 'desc';
		} else {
			sort = column;
			order = column === 'site_name' ? 'asc' : 'desc';
		}
		void reload();
	}

	function sortMark(column: VisitListSort): string {
		if (sort !== column) return '';
		return order === 'desc' ? ' ↓' : ' ↑';
	}


	function open(item: VisitListRow) {
		goto(`${base}/sites/${item.site_id}?tab=visits&event=${item.id}`);
	}
</script>

<svelte:head><title>Visits · RIVER Data</title></svelte:head>

<div class="space-y-4">
	<Breadcrumbs items={[{ label: 'Visits' }]} />

	{#if canVerify}
		<div class="flex items-center gap-1" role="group" aria-label="Which visits">
			<Button size="sm" variant={pendingView ? 'ghost' : 'primary'} onclick={() => (pendingView = false)}>All visits</Button>
			<Button size="sm" variant={pendingView ? 'primary' : 'ghost'} onclick={() => (pendingView = true)}>Pending verification</Button>
		</div>
	{/if}

	{#if canVerify && pendingView}
		<PendingVerifications />
	{:else}
	<EventPanel bind:this={panel} load={loadPage} perPage={100} colCount={7} onRowClick={open} emptyText="No visits">
		{#snippet filterBar({ reload })}
			<div class="flex items-center gap-2">
				<SiteSelect
					bind:value={siteFilter}
					onchange={() => reload()}
					placeholder="All sites"
					class="px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-sm"
				/>
				<Button size="sm" variant="primary" onclick={() => (newVisitOpen = true)}>New visit</Button>
				<a class="text-sm text-brand-primary hover:underline" href="{base}/visits/new">
					Paste a sheet
				</a>
				<NewVisitDialog bind:open={newVisitOpen} onadded={() => reload()} />
			</div>
		{/snippet}
		{#snippet head({ reload })}
			<th class="text-left px-4 py-2 font-semibold">
				<button class="bg-transparent border-none p-0 font-semibold cursor-pointer hover:underline" onclick={() => toggleSort('collected_at', reload)}>Date{sortMark('collected_at')}</button>
			</th>
			<th class="text-left px-4 py-2 font-semibold">
				<button class="bg-transparent border-none p-0 font-semibold cursor-pointer hover:underline" onclick={() => toggleSort('site_name', reload)}>Site{sortMark('site_name')}</button>
			</th>
			<th class="text-left px-4 py-2 font-semibold">Source</th>
			<th class="text-right px-4 py-2 font-semibold">
				<button class="bg-transparent border-none p-0 font-semibold cursor-pointer hover:underline" title="Parameters with a served value at the visit" onclick={() => toggleSort('parameters_filled', reload)}>Filled{sortMark('parameters_filled')}</button>
			</th>
			<th class="text-right px-4 py-2 font-semibold">
				<button class="bg-transparent border-none p-0 font-semibold cursor-pointer hover:underline" title="Open findings at the visit: missing or stale outputs, statistics disagreements, holds" onclick={() => toggleSort('findings_open', reload)}>Findings{sortMark('findings_open')}</button>
			</th>
			<th class="text-left px-4 py-2 font-semibold">By</th>
			<th class="text-left px-4 py-2 font-semibold">Notes</th>
			<th class="text-left px-4 py-2 font-semibold"><span class="sr-only">Entry</span></th>
		{/snippet}
		{#snippet row(item)}
			{@const state = verificationBadge(item.unverified, item.withdrawn_at)}
			<td class="px-4 py-2 text-xs whitespace-nowrap">
				{formatDateTime(item.collected_at)}
				{#if RECOMPUTE_BADGE[item.recompute]}
					<Badge variant={RECOMPUTE_BADGE[item.recompute].variant}>{RECOMPUTE_BADGE[item.recompute].label}</Badge>
				{/if}
			</td>
			<td class="px-4 py-2 text-xs">{item.site_name}</td>
			<td class="px-4 py-2">
				{#if item.source === 'portal_sync'}
					<Badge variant="accent">portal</Badge>
				{:else}
					<Badge variant="muted">manual</Badge>
				{/if}
				{#if state}
					<Badge variant={state.variant}>{state.label}</Badge>
				{/if}
			</td>
			<td class="px-4 py-2 text-xs text-right tabular-nums {item.parameters_filled === 0 ? 'text-brand-muted' : ''}">{item.parameters_filled}</td>
			<td class="px-4 py-2 text-xs text-right tabular-nums">
				{#if item.findings_open > 0}
					<Badge variant="warning">{item.findings_open}</Badge>
				{:else}
					<span class="text-brand-muted">0</span>
				{/if}
			</td>
			<td class="px-4 py-2 text-xs text-brand-muted">{item.created_by ?? '-'}</td>
			<td class="px-4 py-2 text-xs text-brand-muted truncate max-w-64">{item.notes ?? ''}</td>
			<td class="px-4 py-2 text-xs whitespace-nowrap">
				<a
					class="text-brand-primary hover:underline"
					href="{base}/sites/{item.site_id}?tab=visits&event={item.id}"
					onclick={(e) => e.stopPropagation()}>Open the visit</a
				>
			</td>
		{/snippet}
	</EventPanel>
	{/if}
</div>
